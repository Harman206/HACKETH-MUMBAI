# ENSv2 on Sepolia — verified notes

Checked on chain and against source on 2026-11-06. Sources: `ensdomains/contracts-v2@main`
(`contracts/src/...`) and `ensdomains/verifiable-factory@main`.

## Addresses (live, canonical)

| Contract | Address | How verified |
|---|---|---|
| UniversalResolver (stable proxy, **used by the kit**) | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | EIP-1967 slot → `0x6d80…e6F1` → impl `0x24e1…2d72` |
| UniversalResolverV2 impl (PRD address) | `0x24e1d8e068620b647ca097f961a61055f4f42d72` | `resolve()` returns the resolver set at registration |
| ETHRegistrar (PRD) | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` | thousands of `NameRegistered` events in the last 400k blocks |
| ETH registry | `0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4` | `ETHRegistrar.ETH_REGISTRY()` |
| VerifiableFactory (PRD) | `0xda70306c98e97ece36f997a21368e53298572991` | has code |
| PermissionedResolverImpl (PRD) | `0x115eb53f0c60696633855f90b138178fb40b2b2c` | `ROOT_RESOURCE()` = 0 |
| Payment token (mock USDC, 6 dp, free `mint`) | `0x240b0316Df57887DBBE58b586508b19e633a14aa` | `paymentToken` in recent `NameRegistered` |

The repo's `deployments/sepolia*` folders hold **older** sets with different addresses. Do not use them.

## Registration

- Public `.eth` registration is **open**. Commit/reveal: `MIN_COMMITMENT_AGE` = 60 s, max 86 400 s, minimum duration 28 days.
- It is paid in an **ERC20** (`paymentToken`), pulled from `msg.sender` via `transferFrom`. On Sepolia it is mock USDC with a free `mint(address,uint256)`. 28 days of `demoswap-blackout` = 0.61 USDC.
- `register(label, owner, secret, subregistry, resolver, duration, paymentToken, referrer)` sets the **owner and resolver in one call**. The owner receives `ROLE_SET_SUBREGISTRY(+ADMIN) | ROLE_SET_RESOLVER(+ADMIN) | ROLE_CAN_TRANSFER_ADMIN` on the registry.

## PermissionedResolver: differs from the PRD

| PRD says | Source says |
|---|---|
| `initialize([{Safe, ALL_ROLES}], [])` | `initialize(address admin, uint256 roleBitmap, bytes[] setters)`; setters run as a multicall during init, without role checks |
| `grantSetterRoles(setText(node,"url",""), webKey)` | `authorizeTextRoles(bytes dnsName, string key, address account, bool grant)`; caller needs `ROLE_SET_TEXT_ADMIN` on `resource(node,0)` |
| generic `grantRoles` | `grantRoles` / `revokeRoles` are **disabled** (always revert `EACCannotGrantRoles`) |
| upgrade role | `_authorizeUpgrade` requires root `ROLE_UPGRADE` (1<<124); UUPS `upgradeToAndCall` |

- Text write check (`onlyPartRoles`): passes if the caller holds `ROLE_SET_TEXT` on `resource(node, keccak(key))`, on `resource(0, keccak(key))`, or on `resource(node, 0)` (which falls back to root). Otherwise it reverts `EACUnauthorizedAccountRoles(resource(node,0), ROLE_SET_TEXT, caller)`.
- `resource(node, part) = keccak256(abi.encode(node, part))`; `partHash(key) = keccak256(bytes(key))`.
- `ALL_ROLES = 0x1111…1111` (every role nybble + admin nybble).

## Our setup (replaces PRD "Setup steps")

1. Deployer EOA: `VerifiableFactory.deployProxy(PermissionedResolverImpl, salt, initialize(Safe, ALL_ROLES, [setText url, release, manifest]))`. Only the Safe holds roles; the deployer holds none.
2. Deployer EOA: mint mock USDC, approve the registrar, `commit`, wait 60 s, `register(label, owner=Safe, resolver=proxy, …)`. No separate `setResolver` is needed.
3. Safe (2-of-3, `execTransaction`): `authorizeTextRoles(dns("demoswap-blackout.eth"), "url", webKey, true)`.
4. Safe: later `setText` updates of release/manifest.

## Must-revert (web key)

- `resolver.setText(node, "org.blackout.release", …)` → `EACUnauthorizedAccountRoles`
- `registry.setResolver(tokenId, evil)` → `EACUnauthorizedAccountRoles` (registry is EAC too)
- `resolver.upgradeToAndCall(evilImpl, "")` → `EACUnauthorizedAccountRoles` (root `ROLE_UPGRADE`)
- `resolver.authorizeTextRoles(name, "org.blackout.release", webKey, true)` and `grantRootRoles(ALL, webKey)` → revert
- `resolver.setText(node, "url", …)` → succeeds
