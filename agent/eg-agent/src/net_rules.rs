//! What the internet-off filters say, as plain data. `wfp_filter` turns each rule into a WFP filter;
//! nothing here touches Windows, so the policy can be tested anywhere.
//!
//! Outbound connects are blocked on all interfaces, except loopback, DHCP and the allowed addresses
//! (the teacher PC). A higher weight is evaluated first and a permit ends the evaluation.

use std::net::Ipv4Addr;

pub const PERMIT_WEIGHT: u8 = 10;
pub const BLOCK_WEIGHT: u8 = 1;

const DHCP_V4_SERVER_PORT: u16 = 67;
const DHCP_V6_SERVER_PORT: u16 = 547;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    ConnectV4,
    ConnectV6,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Permit,
    Block,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Condition {
    /// Every outbound connect.
    Any,
    Loopback,
    UdpRemotePort(u16),
    RemoteV4(Ipv4Addr),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rule {
    pub label: String,
    pub layer: Layer,
    pub action: Action,
    pub weight: u8,
    pub condition: Condition,
}

impl Rule {
    fn permit(label: &str, layer: Layer, condition: Condition) -> Self {
        Self {
            label: label.to_string(),
            layer,
            action: Action::Permit,
            weight: PERMIT_WEIGHT,
            condition,
        }
    }

    fn block(label: &str, layer: Layer) -> Self {
        Self {
            label: label.to_string(),
            layer,
            action: Action::Block,
            weight: BLOCK_WEIGHT,
            condition: Condition::Any,
        }
    }
}

/// An address list as typed on the command line or sent by the app: IPv4 literals only, no
/// duplicates, none that would match everything or nothing useful.
pub fn parse_addresses(text: &str) -> Result<Vec<Ipv4Addr>, String> {
    let mut out: Vec<Ipv4Addr> = Vec::new();
    for part in text.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let ip: Ipv4Addr = part
            .parse()
            .map_err(|_| format!("`{part}` is not an IPv4 address"))?;
        if ip.is_unspecified() || ip.is_broadcast() || ip.is_multicast() {
            return Err(format!("`{part}` cannot be an allowed address"));
        }
        if !out.contains(&ip) {
            out.push(ip);
        }
    }
    if out.is_empty() {
        return Err("at least one allowed address is required".to_string());
    }
    Ok(out)
}

/// The full filter set. An empty `allow` is refused: with no way to reach the teacher the student
/// could not even submit.
pub fn build_rules(allow: &[Ipv4Addr]) -> Result<Vec<Rule>, String> {
    if allow.is_empty() {
        return Err("at least one allowed address is required".to_string());
    }
    let mut rules = vec![
        Rule::permit("loopback", Layer::ConnectV4, Condition::Loopback),
        Rule::permit("loopback", Layer::ConnectV6, Condition::Loopback),
        Rule::permit(
            "dhcp",
            Layer::ConnectV4,
            Condition::UdpRemotePort(DHCP_V4_SERVER_PORT),
        ),
        Rule::permit(
            "dhcp",
            Layer::ConnectV6,
            Condition::UdpRemotePort(DHCP_V6_SERVER_PORT),
        ),
    ];
    for ip in allow {
        rules.push(Rule::permit(
            &format!("allow {ip}"),
            Layer::ConnectV4,
            Condition::RemoteV4(*ip),
        ));
    }
    rules.push(Rule::block("block all", Layer::ConnectV4));
    rules.push(Rule::block("block all", Layer::ConnectV6));
    Ok(rules)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(text: &str) -> Ipv4Addr {
        text.parse().expect("test address")
    }

    #[test]
    fn rules_permit_loopback_dhcp_and_each_allowed_address() {
        let rules = build_rules(&[ip("192.168.1.10"), ip("10.0.0.2")]).expect("rules");
        let permits = |layer, cond| {
            rules
                .iter()
                .any(|r| r.layer == layer && r.action == Action::Permit && r.condition == cond)
        };
        assert!(permits(Layer::ConnectV4, Condition::Loopback));
        assert!(permits(Layer::ConnectV6, Condition::Loopback));
        assert!(permits(Layer::ConnectV4, Condition::UdpRemotePort(67)));
        assert!(permits(Layer::ConnectV6, Condition::UdpRemotePort(547)));
        assert!(permits(
            Layer::ConnectV4,
            Condition::RemoteV4(ip("192.168.1.10"))
        ));
        assert!(permits(
            Layer::ConnectV4,
            Condition::RemoteV4(ip("10.0.0.2"))
        ));
    }

    #[test]
    fn allowed_addresses_are_only_permitted_over_ipv4() {
        let rules = build_rules(&[ip("192.168.1.10")]).expect("rules");
        assert!(rules
            .iter()
            .filter(|r| matches!(r.condition, Condition::RemoteV4(_)))
            .all(|r| r.layer == Layer::ConnectV4));
    }

    #[test]
    fn both_layers_end_in_a_block_that_loses_to_every_permit() {
        let rules = build_rules(&[ip("192.168.1.10")]).expect("rules");
        for layer in [Layer::ConnectV4, Layer::ConnectV6] {
            let blocks: Vec<_> = rules
                .iter()
                .filter(|r| r.layer == layer && r.action == Action::Block)
                .collect();
            assert_eq!(blocks.len(), 1);
            assert_eq!(blocks[0].condition, Condition::Any);
            assert!(rules
                .iter()
                .filter(|r| r.layer == layer && r.action == Action::Permit)
                .all(|r| r.weight > blocks[0].weight));
        }
    }

    #[test]
    fn no_allowed_address_is_refused() {
        assert!(build_rules(&[]).is_err());
        assert!(parse_addresses("").is_err());
        assert!(parse_addresses(" , ").is_err());
    }

    #[test]
    fn parse_accepts_a_list_and_drops_duplicates() {
        let list = parse_addresses("192.168.1.10, 10.0.0.2,192.168.1.10").expect("list");
        assert_eq!(list, vec![ip("192.168.1.10"), ip("10.0.0.2")]);
    }

    #[test]
    fn parse_rejects_anything_but_a_usable_ipv4_literal() {
        for bad in [
            "0.0.0.0",
            "255.255.255.255",
            "224.0.0.251",
            "::1",
            "fe80::1",
            "teacher-pc",
            "192.168.1",
            "192.168.1.10:47820",
            "999.1.1.1",
        ] {
            assert!(parse_addresses(bad).is_err(), "{bad} should be refused");
        }
    }
}
