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

## PermissionedResolver — the live API (the PRD was right, contracts-v2 `main` is NOT what is deployed)

The live implementation `0x115e…2b2c` matches the ENS docs (`ensv2/permissioned-resolver`) and
`ensjs-abi/src/v2/permissionedResolver.ts`. Its selectors come from the deployed bytecode
(`cast selectors`). The `contracts-v2` `main` branch has a different, node-based API (`authorizeTextRoles`, `initialize(admin, bitmap, setters)`). Do not use it.

| Function | Notes |
|---|---|
| `initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)` | grants on ROOT_RESOURCE; `calls` run as a multicall with role checks skipped |
| `setText(bytes dnsName, string key, string value)` | **name-based** (DNS-encoded), not node-based |
| `grantSetterRoles(bytes setter, address account)` | `setter` = calldata of e.g. `setText(anyName, "url", "")`; only the selector and key matter |
| `revokeRoles(uint256 resource, uint256 bitmap, address)` | argument resource = `uint256(keccak256(bytes(key)))` |
| `grantRoles(...)` | disabled, always reverts `EACCannotGrantRoles` |
| `grantRootRoles(bitmap, account)` | needs the admin role for each bit |
| `upgradeToAndCall` | root `ROLE_UPGRADE` (1<<124) |

Roles: `ROLE_SET_TEXT = 1<<4`, `ROLE_LINK = 1<<28`, `ROLE_UPGRADE = 1<<124`, admin = role<<128. `ALL_ROLES = 0x1111…1111`.

**Scope caveat (docs):** resolver roles are per resolver, not per name. The web key's `url` grant covers `url` on every name this resolver serves. We deploy one resolver per protocol name, so that is exactly one name.

## Our setup (replaces the PRD "Setup steps"), proven in `test/SetupName.fork.t.sol`

1. Deployer EOA: `SafeProxyFactory.createProxyWithNonce` → a 2-of-3 Safe.
2. Deployer EOA: `VerifiableFactory.deployProxy(PermissionedResolverImpl, salt, initialize([(Safe, ALL_ROLES)], [setText url, release, manifest]))`. Only the Safe holds roles.
3. Deployer EOA: mint mock USDC, approve, `commit`. Wait ≥ 60 s. Then `register(label, owner=Safe, resolver=proxy, …)`. No separate `setResolver` step.
4. Safe (`execTransaction`, 2 owner signatures): `grantSetterRoles(setText(name,"url",""), webKey)`.
5. Safe: later `setText` updates of release and manifest.

## Must-revert (web key)

- `resolver.setText(name, "org.blackout.release", …)` → `EACUnauthorizedAccountRoles`
- `registry.setResolver(tokenId, evil)` → revert (registry EAC)
- `resolver.upgradeToAndCall(evilImpl, "")` → revert (root `ROLE_UPGRADE`)
- `resolver.grantSetterRoles(setText(name,"org.blackout.release",""), webKey)` and `grantRootRoles(ALL, webKey)` → revert
- `resolver.setText(name, "url", …)` → succeeds

## Subnames (agent identity), proven in `test/AgentIdentity.fork.t.sol`

Docs: `ensv2/subnames`, `ensv2/registry-template`. Checked 2026-11-07.

- The live ETH registry has `setSubregistry(uint256 anyId, address)`, `register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry)` and `setParent(address, string)` (selectors from bytecode + 4byte). `anyId` accepts the labelhash.
- UserRegistry implementation: `0x840Fa461059862Ea466A711E8C98c8dE732061C0` (`contracts-v2/contracts/docs/addresses/sepolia.md`). That file lists a newer ENSv2 set (other ETHRegistry, factory, LabelStore) that the UniversalResolver does **not** use, but this implementation works standalone: proxied through *our* VerifiableFactory (`0xda70…2991`) with `initialize(address rootAccount, uint256 roleBitmap)`, attached under the live ETH registry, and the live UniversalResolver walks into it. No UserRegistry of the `0xD4eB…` generation was found among the factory's `ProxyDeployed` implementations.
- Steps: deployer deploys the UserRegistry proxy (roles: Safe only) and a separate PermissionedResolver for the subname (records written in `initialize`, roles: Safe only). Safe: `ethRegistry.setSubregistry(labelhash, subregistry)`, `subregistry.setParent(ethRegistry, label)`, `subregistry.register("watcher", Safe, 0, agentResolver, roles, parentExpiry)`. The Safe's fallback handler accepts the ERC-1155 token.
- Why a separate resolver: resolver roles are per resolver, not per name. On the parent's resolver the website key's `url` grant would also cover `url` on the subname.
- `addr(bytes32)` resolves via `setAddress(name, 60, abi.encodePacked(addr))`.
- Revoke: `revokeRoles(uint256(keccak256(key)), ROLE_SET_TEXT, account)` works from the Safe (root admin roles), also inside the resolver's `multicall(bytes[])`. A non-admin gets `EACCannotRevokeRoles`.

