export type MarketplaceAvailability =
  | 'enabled'
  | 'read-only'
  | 'feature-gated'
  | 'feature-gated-testnet-only';

export type MarketplaceMode =
  | 'in-app-execution'
  | 'external-execution'
  | 'read-only'
  | 'psbt-routing-only'
  | 'trade-preview-only'
  | 'live-read-only';

export interface Surface {
  label: string;
  actions: string[];
}

export interface SupportedAction {
  action: string;
  mode: string | null;
  [key: string]: unknown;
}

export interface UnsupportedAction {
  action: string;
  reason: string;
  [key: string]: unknown;
}

export interface MarketplacePolicy {
  availability: MarketplaceAvailability;
  mode: MarketplaceMode;
  owner: string | null;
  featureGate: string | null;
  actions: {
    supported: SupportedAction[];
    unsupported: UnsupportedAction[];
  };
  [key: string]: unknown;
}

export interface Protocol {
  id: string;
  name: string;
  chain: string;
  carrier: string;
  purpose: string;
  operations: string[];
  documentationSite?: string | null;
  universeImplementation?: string | null;
  capabilityId?: string | null;
  origin: {
    kind: 'universe-original' | 'universe-view' | 'external';
    creator?: string | null;
    year?: number | null;
    note?: string | null;
  };
  aliases: string[];
  surfaces: Surface[];
  marketplace: MarketplacePolicy | null;
  indexer: {
    primary: string;
    fallbacks: string[];
    mutationGate: string | null;
  } | null;
  confirmation: {
    policy: string;
    listingMinConfirmations?: number | null;
    settlementMinConfirmations?: number | null;
  } | null;
  reorg: {
    policy: string;
    automaticReconciliation?: boolean;
  } | null;
  freshness: {
    policy: string;
    enforced?: boolean;
    maxLagBlocks?: number | null;
    maxObservationAgeMs?: number | null;
  } | null;
  sourceOfTruth: unknown;
  ownershipModel: unknown;
  decimals: unknown;
  [key: string]: unknown;
}

export interface Product {
  id: string;
  name: string;
  tagline: string;
  documentationSite: string;
  liveUrl: string | null;
  statusEndpoints: string[];
  chains: string[];
  capabilitySurface?: keyof typeof SURFACE_LABELS | null;
  [key: string]: unknown;
}

export interface Chain {
  id: string;
  name: string;
  ticker: string;
  networks: string[];
  blockTargetMinutes: number;
  dataCarriers: string[];
  [key: string]: unknown;
}

export interface Provenance {
  repository: string;
  sourceCommit: string;
  [key: string]: unknown;
}

export const provenance: Provenance;
export const chains: Chain[];
export const products: Product[];
export const protocols: Protocol[];

export const SURFACE_LABELS: {
  readonly main: 'Core';
  readonly wallet: 'Wallet';
  readonly inscribe: 'Inscribe';
  readonly stampdex: 'StampDEX';
};

export const AVAILABILITY_LABELS: Record<
  MarketplaceAvailability,
  { readonly label: string; readonly summary: string }
>;

export const MODE_LABELS: Record<MarketplaceMode, string>;

export function getProtocol(id: string): Protocol | null;
export function protocolsByChain(chainId: string): Protocol[];
export function getProduct(id: string): Product | null;
export function getChain(id: string): Chain | null;
export function protocolsForProduct(
  productId: string,
): Array<{ protocol: Protocol; actions: string[] }>;
export function protocolsWithSites(): Protocol[];
export function validateRegistry(): string[];
