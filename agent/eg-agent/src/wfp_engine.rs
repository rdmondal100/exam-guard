//! A dynamic WFP session: the sublayer and every filter added through it are removed by Windows
//! when the session handle closes, which also happens when this process is killed. So a crash or a
//! reboot can never leave a PC without internet, and no persistent filter ever exists.

use std::ptr::{null, null_mut};

use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
    FwpmEngineClose0, FwpmEngineOpen0, FwpmSubLayerAdd0, FwpmTransactionAbort0,
    FwpmTransactionBegin0, FwpmTransactionCommit0, FWPM_DISPLAY_DATA0, FWPM_SESSION0,
    FWPM_SESSION_FLAG_DYNAMIC, FWPM_SUBLAYER0,
};
use windows_sys::Win32::System::Rpc::RPC_C_AUTHN_WINNT;

use crate::net_block::FilterBackend;
use crate::net_rules::Rule;
use crate::win::wide;

/// Our one sublayer. Highest weight, so Windows evaluates it before the firewall's own.
pub const SUBLAYER_KEY: GUID = GUID::from_u128(0x6c4e_5a1b_7d52_4f0e_9a3b_e8d1_47c2_b5f0);

/// A WFP call's return value is a Win32 or `FWP_E_*` error code; 0 is success.
pub fn fwp(code: u32, what: &str) -> Result<(), String> {
    if code == 0 {
        return Ok(());
    }
    let text = std::io::Error::from_raw_os_error(code as i32);
    Err(format!("{what} failed: 0x{code:08x} ({text})"))
}

struct Engine(HANDLE);

// SAFETY: a WFP engine handle is an RPC context handle that the API allows to be used from any
// thread; this type only ever uses it from one thread at a time (behind the `NetControl` mutex).
unsafe impl Send for Engine {}

impl Engine {
    fn open() -> Result<Self, String> {
        let mut name = wide("ExamGuard internet off");
        let mut session = FWPM_SESSION0::default();
        session.displayData.name = name.as_mut_ptr();
        session.flags = FWPM_SESSION_FLAG_DYNAMIC;
        let mut handle: HANDLE = null_mut();
        // SAFETY: `session` and `name` outlive the call; a null server means this PC, a null
        // identity means the calling account.
        let code =
            unsafe { FwpmEngineOpen0(null(), RPC_C_AUTHN_WINNT, null(), &session, &mut handle) };
        fwp(code, "FwpmEngineOpen0")?;
        Ok(Self(handle))
    }

    /// Adds the sublayer and all rules, or none of them.
    fn add_all(&self, rules: &[Rule]) -> Result<(), String> {
        // SAFETY: `self.0` is an open engine handle.
        fwp(
            unsafe { FwpmTransactionBegin0(self.0, 0) },
            "FwpmTransactionBegin0",
        )?;
        match self.add_in_transaction(rules) {
            // SAFETY: as above; the transaction is open.
            Ok(()) => fwp(
                unsafe { FwpmTransactionCommit0(self.0) },
                "FwpmTransactionCommit0",
            ),
            Err(error) => {
                // SAFETY: as above.
                let _ = unsafe { FwpmTransactionAbort0(self.0) };
                Err(error)
            }
        }
    }

    fn add_in_transaction(&self, rules: &[Rule]) -> Result<(), String> {
        let mut name = wide("ExamGuard internet off");
        let sublayer = FWPM_SUBLAYER0 {
            subLayerKey: SUBLAYER_KEY,
            displayData: FWPM_DISPLAY_DATA0 {
                name: name.as_mut_ptr(),
                ..Default::default()
            },
            weight: u16::MAX,
            ..Default::default()
        };
        // SAFETY: `self.0` is open with a transaction; `sublayer` and `name` outlive the call.
        let code = unsafe { FwpmSubLayerAdd0(self.0, &sublayer, null_mut()) };
        fwp(code, "FwpmSubLayerAdd0")?;
        rules
            .iter()
            .try_for_each(|rule| crate::wfp_filter::add(self.0, rule))
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // SAFETY: the handle came from FwpmEngineOpen0 and is closed once, here. Closing a dynamic
        // session removes everything it added.
        if let Err(error) = fwp(unsafe { FwpmEngineClose0(self.0) }, "FwpmEngineClose0") {
            tracing::error!(%error, "closing the WFP session failed");
        }
    }
}

/// The real `FilterBackend`: one engine session holds the whole filter set.
#[derive(Default)]
pub struct WfpBackend {
    engine: Option<Engine>,
}

impl FilterBackend for WfpBackend {
    fn install(&mut self, rules: &[Rule]) -> Result<(), String> {
        // The old set goes first (same sublayer key); a failure below leaves nothing installed.
        self.engine = None;
        let engine = Engine::open()?;
        engine.add_all(rules)?;
        self.engine = Some(engine);
        Ok(())
    }

    fn remove(&mut self) -> Result<(), String> {
        self.engine = None;
        Ok(())
    }
}
