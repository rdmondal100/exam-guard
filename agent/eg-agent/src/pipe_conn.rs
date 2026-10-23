//! A named-pipe end (server instance or client), with the few calls the agent needs.
//!
//! Handles are synchronous. Reading never blocks the service side: callers ask `available()`
//! (`PeekNamedPipe`) first, so one thread can poll for input, send heartbeats and watch a deadline.

use std::io;
use std::os::windows::io::{AsRawHandle, OwnedHandle};
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{LocalFree, ERROR_PIPE_CONNECTED, HANDLE};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FlushFileBuffers, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE,
    OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeClientProcessId,
    PeekNamedPipe, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_WAIT,
};

use crate::win::{last_error, owned, wide};

const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const BUFFER: u32 = 64 * 1024;

pub struct Conn {
    handle: OwnedHandle,
}

impl Conn {
    fn raw(&self) -> HANDLE {
        self.handle.as_raw_handle()
    }

    /// Creates one instance of a pipe. The pipe's security comes from `sddl` (the first instance
    /// fixes it). `first` adds `FILE_FLAG_FIRST_PIPE_INSTANCE`, so the call fails if anyone else
    /// already owns the name. `max_instances` is shared by every instance of the name: a server
    /// that creates all of them up front leaves no slot for another process to take.
    pub fn create_instance(
        name: &str,
        sddl: &str,
        first: bool,
        max_instances: u32,
    ) -> Result<Self, String> {
        let name = wide(name);
        let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
        // SAFETY: the SDDL is NUL-terminated and the out pointer is valid.
        let converted = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide(sddl).as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        };
        if converted == 0 {
            return Err(last_error(
                "ConvertStringSecurityDescriptorToSecurityDescriptorW",
            ));
        }
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let open_mode = PIPE_ACCESS_DUPLEX
            | if first {
                FILE_FLAG_FIRST_PIPE_INSTANCE
            } else {
                0
            };
        // SAFETY: the name and the attributes outlive the call.
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                open_mode,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                max_instances,
                BUFFER,
                BUFFER,
                0,
                &attributes,
            )
        };
        let created = owned(handle, "CreateNamedPipeW");
        // SAFETY: the descriptor was allocated by the conversion call above.
        unsafe { LocalFree(descriptor) };
        created.map(|handle| Self { handle })
    }

    /// Opens the client end of a pipe that has a free instance.
    pub fn connect(name: &str) -> io::Result<Self> {
        let name = wide(name);
        // SAFETY: the name is NUL-terminated.
        let handle = unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                null(),
                OPEN_EXISTING,
                0,
                null_mut(),
            )
        };
        owned(handle, "CreateFileW")
            .map(|handle| Self { handle })
            .map_err(|_| io::Error::last_os_error())
    }

    /// Blocks until a client connects to this instance.
    pub fn wait_for_client(&self) -> io::Result<()> {
        // SAFETY: valid pipe handle, no OVERLAPPED.
        if unsafe { ConnectNamedPipe(self.raw(), null_mut()) } != 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        // The client connected between CreateNamedPipe and here: that is a success.
        if error.raw_os_error() == Some(ERROR_PIPE_CONNECTED as i32) {
            Ok(())
        } else {
            Err(error)
        }
    }

    /// Ends the current client's connection so this instance can wait for the next one.
    pub fn disconnect(&self) {
        // SAFETY: valid pipe handle. A failed flush only means the client is already gone.
        unsafe {
            FlushFileBuffers(self.raw());
            DisconnectNamedPipe(self.raw());
        }
    }

    pub fn client_pid(&self) -> Option<u32> {
        let mut pid = 0u32;
        // SAFETY: valid pipe handle and out pointer.
        (unsafe { GetNamedPipeClientProcessId(self.raw(), &mut pid) } != 0).then_some(pid)
    }

    /// Bytes waiting to be read. An error (usually `BrokenPipe`) means the other end is gone.
    pub fn available(&self) -> io::Result<usize> {
        let mut waiting = 0u32;
        // SAFETY: valid pipe handle; only the "total bytes available" out value is requested.
        let ok = unsafe {
            PeekNamedPipe(
                self.raw(),
                null_mut(),
                0,
                null_mut(),
                &mut waiting,
                null_mut(),
            )
        };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(waiting as usize)
        }
    }

    /// Reads up to `buf.len()` bytes. Blocks when nothing is waiting.
    pub fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
        let mut read = 0u32;
        // SAFETY: the buffer is valid for `buf.len()` bytes.
        let ok = unsafe {
            ReadFile(
                self.raw(),
                buf.as_mut_ptr(),
                buf.len().min(u32::MAX as usize) as u32,
                &mut read,
                null_mut(),
            )
        };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(read as usize)
        }
    }

    pub fn write_all(&self, mut bytes: &[u8]) -> io::Result<()> {
        while !bytes.is_empty() {
            let mut written = 0u32;
            // SAFETY: the buffer is valid for `bytes.len()` bytes.
            let ok = unsafe {
                WriteFile(
                    self.raw(),
                    bytes.as_ptr(),
                    bytes.len().min(u32::MAX as usize) as u32,
                    &mut written,
                    null_mut(),
                )
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            bytes = &bytes[written as usize..];
        }
        Ok(())
    }
}
