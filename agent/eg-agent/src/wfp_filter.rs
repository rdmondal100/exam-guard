//! Turns a `Rule` into a WFP filter and adds it. Only called inside an open transaction of a
//! dynamic session (`wfp_engine`), so the filter dies with that session.

use std::ptr::null_mut;

use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
    FwpmFilterAdd0, FWPM_CONDITION_FLAGS, FWPM_CONDITION_IP_PROTOCOL,
    FWPM_CONDITION_IP_REMOTE_ADDRESS, FWPM_CONDITION_IP_REMOTE_PORT, FWPM_FILTER0,
    FWPM_FILTER_CONDITION0, FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    FWP_ACTION_BLOCK, FWP_ACTION_PERMIT, FWP_CONDITION_FLAG_IS_LOOPBACK, FWP_CONDITION_VALUE0,
    FWP_MATCH_EQUAL, FWP_MATCH_FLAGS_ALL_SET, FWP_UINT16, FWP_UINT32, FWP_UINT8, FWP_VALUE0,
    FWP_VALUE0_0,
};

use crate::net_rules::{Action, Condition, Layer, Rule};
use crate::wfp_engine::{fwp, SUBLAYER_KEY};
use crate::win::wide;

const IPPROTO_UDP: u8 = 17;

fn layer_key(layer: Layer) -> GUID {
    match layer {
        Layer::ConnectV4 => FWPM_LAYER_ALE_AUTH_CONNECT_V4,
        Layer::ConnectV6 => FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    }
}

fn equal(field: GUID, kind: i32) -> FWPM_FILTER_CONDITION0 {
    FWPM_FILTER_CONDITION0 {
        fieldKey: field,
        matchType: FWP_MATCH_EQUAL,
        conditionValue: FWP_CONDITION_VALUE0 {
            r#type: kind,
            ..Default::default()
        },
    }
}

fn u8_eq(field: GUID, value: u8) -> FWPM_FILTER_CONDITION0 {
    let mut c = equal(field, FWP_UINT8);
    c.conditionValue.Anonymous.uint8 = value;
    c
}

fn u16_eq(field: GUID, value: u16) -> FWPM_FILTER_CONDITION0 {
    let mut c = equal(field, FWP_UINT16);
    c.conditionValue.Anonymous.uint16 = value;
    c
}

fn u32_eq(field: GUID, value: u32) -> FWPM_FILTER_CONDITION0 {
    let mut c = equal(field, FWP_UINT32);
    c.conditionValue.Anonymous.uint32 = value;
    c
}

/// The conditions of one rule. WFP takes an IPv4 address as a `u32` in host byte order.
pub fn conditions(condition: Condition) -> Vec<FWPM_FILTER_CONDITION0> {
    match condition {
        Condition::Any => Vec::new(),
        Condition::Loopback => {
            let mut c = u32_eq(FWPM_CONDITION_FLAGS, FWP_CONDITION_FLAG_IS_LOOPBACK);
            c.matchType = FWP_MATCH_FLAGS_ALL_SET;
            vec![c]
        }
        Condition::UdpRemotePort(port) => vec![
            u8_eq(FWPM_CONDITION_IP_PROTOCOL, IPPROTO_UDP),
            u16_eq(FWPM_CONDITION_IP_REMOTE_PORT, port),
        ],
        Condition::RemoteV4(ip) => vec![u32_eq(FWPM_CONDITION_IP_REMOTE_ADDRESS, u32::from(ip))],
    }
}

pub fn add(engine: HANDLE, rule: &Rule) -> Result<(), String> {
    let mut name = wide(&format!("ExamGuard internet off: {}", rule.label));
    let mut list = conditions(rule.condition);

    let mut filter = FWPM_FILTER0::default();
    filter.displayData.name = name.as_mut_ptr();
    filter.layerKey = layer_key(rule.layer);
    filter.subLayerKey = SUBLAYER_KEY;
    filter.weight = FWP_VALUE0 {
        r#type: FWP_UINT8,
        Anonymous: FWP_VALUE0_0 { uint8: rule.weight },
    };
    filter.numFilterConditions = list.len() as u32;
    if !list.is_empty() {
        filter.filterCondition = list.as_mut_ptr();
    }
    filter.action.r#type = match rule.action {
        Action::Permit => FWP_ACTION_PERMIT,
        Action::Block => FWP_ACTION_BLOCK,
    };

    let mut id = 0u64;
    // SAFETY: `engine` is an open WFP handle with a transaction in progress. `filter` and what it
    // points to (`name`, `list`) stay alive until the call returns, which copies them.
    let code = unsafe { FwpmFilterAdd0(engine, &filter, null_mut(), &mut id) };
    fwp(code, &format!("FwpmFilterAdd0 ({})", rule.label))
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use super::*;

    fn same(a: &GUID, b: &GUID) -> bool {
        a.data1 == b.data1 && a.data2 == b.data2 && a.data3 == b.data3 && a.data4 == b.data4
    }

    #[test]
    fn a_remote_address_is_a_host_order_u32() {
        let list = conditions(Condition::RemoteV4(Ipv4Addr::new(10, 0, 0, 1)));
        assert_eq!(list.len(), 1);
        assert!(same(&list[0].fieldKey, &FWPM_CONDITION_IP_REMOTE_ADDRESS));
        assert_eq!(list[0].matchType, FWP_MATCH_EQUAL);
        assert_eq!(list[0].conditionValue.r#type, FWP_UINT32);
        // SAFETY: the type tag says the union holds a u32.
        assert_eq!(
            unsafe { list[0].conditionValue.Anonymous.uint32 },
            0x0A00_0001
        );
    }

    #[test]
    fn loopback_tests_the_flag_bit() {
        let list = conditions(Condition::Loopback);
        assert_eq!(list.len(), 1);
        assert!(same(&list[0].fieldKey, &FWPM_CONDITION_FLAGS));
        assert_eq!(list[0].matchType, FWP_MATCH_FLAGS_ALL_SET);
        // SAFETY: the type tag says the union holds a u32.
        assert_eq!(
            unsafe { list[0].conditionValue.Anonymous.uint32 },
            FWP_CONDITION_FLAG_IS_LOOPBACK
        );
    }

    #[test]
    fn dhcp_matches_udp_and_the_server_port() {
        let list = conditions(Condition::UdpRemotePort(67));
        assert_eq!(list.len(), 2);
        assert!(same(&list[0].fieldKey, &FWPM_CONDITION_IP_PROTOCOL));
        // SAFETY: the type tags say u8 and u16.
        assert_eq!(unsafe { list[0].conditionValue.Anonymous.uint8 }, 17);
        assert!(same(&list[1].fieldKey, &FWPM_CONDITION_IP_REMOTE_PORT));
        assert_eq!(unsafe { list[1].conditionValue.Anonymous.uint16 }, 67);
    }

    #[test]
    fn a_block_for_everything_has_no_conditions() {
        assert!(conditions(Condition::Any).is_empty());
    }
}
