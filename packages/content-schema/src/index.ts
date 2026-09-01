// Typed model of docs.manifest.json.
// The formal contract is schemas/docs.manifest.schema.json; these types mirror it.

export type Classification =
  | "product"
  | "product-docs"
  | "protocol"
  | "indexer"
  | "implementation"
  | "infrastructure"
  | "ci"
  | "archive";

export type Lifecycle = "stable" | "beta" | "experimental" | "deprecated" | "archived";

export type Chain = "bitcoin" | "dogecoin" | "zcash";

export type Network = "mainnet" | "testnet" | "testnet4" | "signet" | "regtest";

export type Audience =
  | "user"
  | "collector"
  | "app-developer"
  | "protocol-implementer"
  | "indexer-operator"
  | "infrastructure-operator"
  | "security-verifier";

export interface ChainSupport {
  chain: Chain;
  networks: Network[];
}

export interface Contracts {
  openapi?: string[];
  asyncapi?: string[];
  jsonSchema?: string[];
  cli?: string[];
  sdk?: string[];
}

export interface Upstream {
  project: string;
  url: string;
  license: string;
  relationship: "fork" | "port" | "mirror" | "derived";
  divergenceSummary?: string;
}

export interface Redirect {
  from: string;
  to: string;
}

export interface LastVerified {
  commit: string;
  timestamp: string;
}

export interface ArchivedInfo {
  date: string;
  reason?: string;
  replacement: string | null;
}

export interface DocsManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  classification: Classification;
  repository: `bitcoinuniverseio/${string}`;
  documentationUrl: string;
  docsRoot: string;
  sourceRef: string;
  releasedRef?: string;
  releaseVersion?: string;
  lifecycle: Lifecycle;
  chains: ChainSupport[];
  protocols?: string[];
  audiences: Audience[];
  specifications?: string[];
  contracts?: Contracts;
  capabilityManifest?: string;
  statusSources?: string[];
  owners: string[];
  upstream?: Upstream;
  redirects?: Redirect[];
  lastVerified: LastVerified;
  securityClassification: "public";
  archived?: ArchivedInfo;
}
