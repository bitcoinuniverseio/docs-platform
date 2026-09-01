---
title: Wallet provider API
description: The JavaScript provider Universe Wallet injects into pages, what it is called, the rules for using it safely, and where the full reference lives.
---

Universe Wallet injects a JavaScript provider object into every page, so a web application can ask to see an account, request a signature, or broadcast a transaction. This page tells you what the provider is and the rules that come before any code. The complete reference, method by method, lives with the wallet documentation.

**[Read the full provider API reference](https://github.com/bitcoinuniverseio/docs-wallet/blob/main/developers/provider-api.md)** in [docs-wallet](https://github.com/bitcoinuniverseio/docs-wallet), which owns it.

## What you are talking to

With the extension installed, pages get a `window.tapwallet` object. That name is exact: the provider is called `tapwallet`, so detect it by that name.

```js
if (typeof window.tapwallet !== 'undefined') {
  console.log('Universe Wallet is available');
}
```

Every method returns a promise, and a request the user rejects makes that promise reject. Treat rejection as a normal outcome rather than an error condition.

## Three rules before any code

1. **Request a connection only in response to a direct user action**, such as a click on a button you control. Never request one on page load.
2. **Never ask a user for a recovery phrase or private key.** No integration needs either, and no legitimate flow collects them. A page asking for one is an attack, whoever appears to be asking.
3. **Signing happens inside the wallet, not in your page.** Your application submits a request; the user reads it in Universe Wallet and approves or rejects it there.

Connecting means asking to see the user's selected account address. It never authorizes spending: every later transaction or message opens its own approval in the wallet, and idle connections expire on their own.

## What the reference covers

The full reference in docs-wallet documents the connection lifecycle, the account, network, balance, and inscription read methods, the send, inscribe, sign, and broadcast methods including PSBT signing, and the `accountsChanged` and `networkChanged` events, each with parameters, return types, and a worked example. It also links the pages that describe what the user sees on their side of each request, which is the part most integrations get wrong.

## Availability

What the wallet will actually do for a given protocol depends on the release you are integrating against, not on the presence of a method. The wallet documentation states which operations are authorized in the current release; read it before assuming a protocol action will succeed. Availability language across this documentation follows the [shared status terminology](/status/).
