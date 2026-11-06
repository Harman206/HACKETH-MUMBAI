# Related work and public datasets

Survey made on 2026-11-07. Repo facts (license, last push, file contents, counts) were checked through the GitHub API and by
downloading the files. "403" means the site blocks automated fetches, but search results show the page exists.
**Bold rows** are the datasets the benchmarks in this folder actually use.

## Papers, reports and datasets

| # | Item | Authors / venue / year | Link | What it measures | Public data usable here? |
|---|---|---|---|---|---|
| 1 | **Dissecting Payload-based Transaction Phishing on Ethereum (PTXPhish)** | Chen, Hu, He, Luo, Wu, Zhou. NDSS 2025 | [NDSS page](https://www.ndss-symposium.org/ndss-paper/dissecting-payload-based-transaction-phishing-on-ethereum/), arXiv 2409.02386. Data: [blocksecteam/PTXPhish](https://github.com/blocksecteam/PTXPhish) | 130,637 phishing txs and $341.9M lost over 300 days. Also a rule-based detector reporting >99% F1. | **Yes, used in B1 Set B.** `dataset/PTXPHISH.xlsx` lists 5,000 malicious tx hashes by subtype (Approve 1,247, Permit 814, SetApprovalForAll 508, NFT bulk transfer 37, proxy upgrade 108, free buy order 464, address poisoning 226, payable airdrop/wallet functions 1,594) and 13,557 benign ones (KOL and developer txs). No license file. |
| 2 | **Unmasking the Shadow Economy: Drainer-as-a-Service Phishing on Ethereum** | He, Hu, Chen, Chen, Yu, Chang, Wu, Zhou. ACM IMC 2025 | [PDF](https://assets.blocksec.com/pdf/1761189308551-2.pdf). Data: [blocksecteam/DaaS_dataset](https://github.com/blocksecteam/DaaS_dataset) | The DaaS ecosystem from Mar 2023 to Apr 2025: about $135M from about 76.6k victims. Angel, Inferno and Pink drainers took 93.9% of profit. Only 10.8% of DaaS addresses were already flagged on public trackers. | Yes: 56 operators, 6,087 affiliates, 1,910 profit-sharing contracts, 87k profit-sharing txs. Not used yet (see "Next steps" in README). No license file. |
| 3 | TxPhishScope: Detecting and Understanding Transaction-based Phishing on Ethereum | He et al. ACM CCS 2023 | [PDF](https://assets.blocksec.com/pdf/ccs23_phishing.pdf), [data](https://github.com/blocksecteam/TxPhishScope) | A crawler that triggers transactions on suspected phishing sites in a simulator. | Partly: 26,333 phishing URLs (mostly dead now). No addresses. |
| 4 | Penny Wise and Pound Foolish: Risk of Unlimited ERC-20 Approval | Wang et al. RAID 2022 | [arXiv 2207.01790](https://arxiv.org/abs/2207.01790) | 25.4M approvals up to Jul 2021, about 60% of them unlimited. Of 31 DApps/wallets, only 10% explained approvals and 16% let users change the amount. | Motivation only. No dataset released. |
| 5 | Blockchain Address Poisoning | Tsuchiya, Dong, Soska, Christin. USENIX Security 2025 | [USENIX](https://www.usenix.org/conference/usenixsecurity25/presentation/tsuchiya) | 270M poisoning attempts on ETH/BSC; ≥$83.8M lost. | Background for the out-of-scope class in B1. |
| 6 | WalletProbe: testing framework for browser wallet extensions | Hu, He, Wang. arXiv 2504.11735, 2025 | [arXiv](https://arxiv.org/abs/2504.11735) | 39 wallet extensions, including security checkers. Found 13 attack vectors against simulators, alert modules and UIs. | The closest evaluation of wallet "firewalls". No dataset. |
| 7 | SoK: Design, Vulnerabilities, and Security Measures of Cryptocurrency Wallets | Erinle et al. arXiv 2307.12874 (v4 2025) | [arXiv](https://arxiv.org/abs/2307.12874) | Survey of wallet attacks and defenses. | Background. |
| 8 | Security, privacy and decentralization of DeFi front ends | arXiv 2109.06836, 2021 | [arXiv](https://arxiv.org/abs/2109.06836) | Third-party scripts and CDN/cloud centralization in DeFi frontends. | Background for B3 (floating CDN dependencies). |
| 9 | Microsoft, "Ice phishing on the blockchain" | Microsoft Security blog, Feb 2022 | [blog](https://www.microsoft.com/en-us/security/blog/2022/02/16/ice-phishing-on-the-blockchain/) (403) | Coins the term "ice phishing"; BadgerDAO case study. | Citation. |
| 10 | ScamSniffer annual scam reports 2024 and 2025 | Industry | [2024](https://drops.scamsniffer.io/?p=971) | 2024: $494M from 332k wallets; Permit signatures 56.7% of losses. | Statistics only. |
| 11 | Check Point on Inferno / Angel drainers | Industry, 2024–2025 | [blog](https://blog.checkpoint.com/?p=245481) | Single-use contracts, configuration stored on chain. | Indicators of compromise in the text only. |
| 12 | **ScamSniffer scam-database** | ScamSniffer, GPL-3.0 | [github](https://github.com/scamsniffer/scam-database) | `blacklist/domains.json` (360k domains, daily; the public copy is delayed 7 days); `blacklist/address.json` (2,530 addresses, last changed 2024-02-28). | **Yes. Addresses are used in B1 Set A and domains in B2.** Downloaded at run time, not vendored. |
| 13 | **MetaMask eth-phishing-detect** | MetaMask, DBAD license | [github](https://github.com/MetaMask/eth-phishing-detect) | `src/config.json`: 116k blacklist entries, a fuzzylist with tolerance 1. | **Yes, used in B2.** Downloaded at run time. |
| 14 | PhishFort lists | GPL-3.0 | [github](https://github.com/phishfort/phishfort-lists) | Domain blacklist and whitelist. | Usable; not used. |
| 15 | CryptoScamDB | MIT | [github](https://github.com/CryptoScamDB/blacklist) | Stale since 2023-04. | Historical only. |
| 16 | MyEtherWallet darklist | MEW | [github](https://github.com/MyEtherWallet/ethereum-lists) | 715 commented malicious addresses. | Usable; small. |
| 17 | Forta labelled-datasets | MIT | [github](https://github.com/forta-network/labelled-datasets) | Malicious contracts and EOAs. Stale since 2023-01. | Usable; stale. |

## Incident sources (B3)

| Incident | Primary source | Mechanism | Payload public? |
|---|---|---|---|
| Ledger Connect Kit, 2023-12-14 | [Ledger incident report](https://www.ledger.com/blog/security-incident-report) | A former employee's npm account was phished. Versions 1.1.5–1.1.7 were published, and dapps loaded them through the floating `@1` CDN tag. | **Yes.** cdn.jsdelivr.net still serves 1.1.5, 1.1.6 and 1.1.7 (npm and unpkg removed them). The stage-2 package now returns 403. |
| Balancer, 2023-09-19/20 | Balancer post-mortem (Medium, 403) | Social engineering of the EuroDNS registrar. | Not public. The Wayback Machine has a 2023-09-20 04:40 UTC capture of app.balancer.fi showing the hijacked host behind Cloudflare's "Suspected phishing" interstitial. |
| Curve, 2022-08-09 | No formal post-mortem; on-chain evidence in [replay/fixtures/R1.json](../../replay/fixtures/R1.json) | DNS hijack at the iwantmyname registrar; a cloned site with injected approvals. | Not public. Every Wayback capture in the window has the legitimate bytes. |
| Squarespace DNS (Compound, Celer…), July 2024 | Press coverage only (Blockaid / samczsun) | Registrar takeover. | Not public; only one pre-incident capture of app.compound.finance. |
| BadgerDAO 2021 (Cloudflare Worker), KyberSwap 2022 (Google Tag Manager) | Archived post-mortems | Script injection on the real domain without touching DNS. | Not public. |

## Top picks and why

1. **PTXPhish (NDSS'25)**: the only public, peer-reviewed, per-subtype labeled set of real phishing transactions that also has a benign class. It maps one-to-one onto Copeybara's request categories. Used in B1 Set B.
2. **ScamSniffer address list**: ground-truth drainer spenders. Paired with a full-history log search, it gives real victim requests that do not depend on someone else's tx selection. Used in B1 Set A.
3. **MetaMask eth-phishing-detect + ScamSniffer domains**: the two maintained look-alike feeds. Comparing them measures how stale a copied blocklist would be. Used in B2.
4. **Ledger Connect Kit CDN artefacts + Wayback captures**: the only incident with the real injected code still retrievable, plus a real capture of a hijacked DNS target (Balancer). Used in B3.
5. **DaaS_dataset (IMC'25)**: the best next step for B1. Its 1,910 profit-sharing contracts and 6,087 affiliates would widen the drainer set beyond the 2024-frozen ScamSniffer list. It also argues for behavior rules over blocklists, since only 10.8% of DaaS addresses were already flagged.
