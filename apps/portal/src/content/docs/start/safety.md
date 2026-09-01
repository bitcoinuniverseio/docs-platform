---
title: Safety in sixty seconds
description: The rules that keep your assets safe across every Bitcoin Universe product, stated before anything else.
---

Everything documented here operates on real chains. These rules apply everywhere, in every product, on every page of this documentation.

## The rules

1. **Nobody legitimate ever asks for your seed phrase or private keys.** Not our products, not our support, not this documentation, not our tools. Any prompt for a seed phrase outside your own wallet is an attack.
2. **Transactions are irreversible.** There is no undo, no chargeback, and no support action that can reverse a confirmed transaction.
3. **Fees are spent even when an action fails.** A failed mint, a rejected inscription, or an invalid protocol operation still pays its network fee.
4. **Asset-bearing outputs are fragile.** Spending an output that carries an inscription, stamp, or token balance with an ordinary wallet can destroy or transfer the asset unintentionally. Use a wallet that understands the protocol you hold.
5. **Verify addresses and URLs character by character.** Fake sites and lookalike addresses are the most common cause of loss. Our live products are linked from this portal and from [github.com/bitcoinuniverseio](https://github.com/bitcoinuniverseio); trust those routes, not search results or messages.
6. **Unavailable is not empty.** When a data source is down we say so. If a balance or asset unexpectedly shows as missing, check [status](/status/) before acting; never "re-send" because a display looked empty.

## Before any transaction

- Know the network you are on (mainnet, testnet, signet). Mainnet spends real money.
- Know the fee before signing. Our products show the fee anatomy before asking for a signature.
- Know the recovery story. Every transaction workflow in this documentation has a "what can go wrong" section; read it first.

If a page anywhere in this documentation tells you to do something that violates these rules, the page is wrong: [report it](https://github.com/bitcoinuniverseio/.github/blob/main/SUPPORT.md).
