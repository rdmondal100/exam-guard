//! Framing of the agent pipes: a `u32` little-endian length, then that many bytes of UTF-8 JSON
//! (docs/protocol.md §4). `FrameBuffer` takes whatever bytes arrive and hands out whole frames, so
//! a message split across reads is rebuilt and a pipe that stalls mid-frame never blocks a caller.

/// Largest frame either side accepts (the same limit as `MAX_PIPE_FRAME_BYTES` in packages/shared).
pub const MAX_FRAME: usize = 4 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum FrameError {
    TooLarge(usize),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge(len) => write!(f, "frame of {len} bytes is over the {MAX_FRAME} limit"),
        }
    }
}

impl std::error::Error for FrameError {}

/// The bytes to put on the pipe for one message.
pub fn encode(payload: &[u8]) -> Result<Vec<u8>, FrameError> {
    if payload.len() > MAX_FRAME {
        return Err(FrameError::TooLarge(payload.len()));
    }
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

#[derive(Default)]
pub struct FrameBuffer {
    bytes: Vec<u8>,
}

impl FrameBuffer {
    pub fn push(&mut self, data: &[u8]) {
        self.bytes.extend_from_slice(data);
    }

    /// The next whole frame, `None` while one is still incomplete. A length over the limit is an
    /// error and the buffer is not usable afterwards (the caller closes the pipe).
    pub fn next_frame(&mut self) -> Result<Option<Vec<u8>>, FrameError> {
        let Some(header) = self.bytes.first_chunk::<4>() else {
            return Ok(None);
        };
        let len = u32::from_le_bytes(*header) as usize;
        if len > MAX_FRAME {
            return Err(FrameError::TooLarge(len));
        }
        if self.bytes.len() < 4 + len {
            return Ok(None);
        }
        let frame = self.bytes[4..4 + len].to_vec();
        self.bytes.drain(..4 + len);
        Ok(Some(frame))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_round_trips() {
        let mut buffer = FrameBuffer::default();
        buffer.push(&encode(b"{\"t\":\"x\"}").unwrap());
        assert_eq!(buffer.next_frame().unwrap().unwrap(), b"{\"t\":\"x\"}");
        assert_eq!(buffer.next_frame().unwrap(), None);
    }

    #[test]
    fn a_frame_split_across_reads_is_rebuilt() {
        let wire = encode(b"hello world").unwrap();
        let mut buffer = FrameBuffer::default();
        for byte in &wire[..wire.len() - 1] {
            buffer.push(&[*byte]);
            assert_eq!(buffer.next_frame().unwrap(), None);
        }
        buffer.push(&wire[wire.len() - 1..]);
        assert_eq!(buffer.next_frame().unwrap().unwrap(), b"hello world");
    }

    #[test]
    fn two_frames_in_one_read_come_out_in_order() {
        let mut wire = encode(b"one").unwrap();
        wire.extend(encode(b"two").unwrap());
        let mut buffer = FrameBuffer::default();
        buffer.push(&wire);
        assert_eq!(buffer.next_frame().unwrap().unwrap(), b"one");
        assert_eq!(buffer.next_frame().unwrap().unwrap(), b"two");
    }

    #[test]
    fn an_empty_frame_is_a_frame() {
        let mut buffer = FrameBuffer::default();
        buffer.push(&encode(b"").unwrap());
        assert_eq!(buffer.next_frame().unwrap().unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn an_oversized_length_is_refused_before_any_payload_arrives() {
        let mut buffer = FrameBuffer::default();
        buffer.push(&((MAX_FRAME as u32) + 1).to_le_bytes());
        assert_eq!(
            buffer.next_frame(),
            Err(FrameError::TooLarge(MAX_FRAME + 1))
        );
        assert!(encode(&vec![0; MAX_FRAME + 1]).is_err());
    }
}
