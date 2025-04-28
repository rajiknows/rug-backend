export interface Env {
    DATABASE_URL: string;
    UPSTASH_REDIS_REST_URL?: string;
    UPSTASH_REDIS_REST_TOKEN?: string;
    TOKEN_UPDATE_QUEUE: Queue<TokenBatchMessage>;
}

// message type for the queue
export interface TokenBatchMessage {
    mints: string[];
}

/// here i wrote the interfaces for responses from the api spec

export interface PriceResponse {
    price: number;
}

export interface VotesResponse {
    up: number;
    down: number;
    userVoted: boolean;
}

export interface TokenAccount {
    mintAuthority: string | null;
    supply: string;
    decimals: number;
    isInitialized: boolean;
    freezeAuthority: string | null;
}

export interface TokenExtensionMetadataPointer {
    authority: string;
    metadataAddress: string;
}

export interface TokenExtensionTokenMetadata {
    authority: string;
    mint: string;
    name: string;
    symbol: string;
    uri: string;
    additionalMetadata: Record<string, unknown>;
}

export interface TokenExtension {
    nonTransferable: boolean;
    transferFeeConfig: null;
    defaultAccountState: null;
    permanentDelegate: null;
    metadataPointer: TokenExtensionMetadataPointer | null;
    groupPointer: null;
    groupMemberPointer: null;
    tokenMetadata: TokenExtensionTokenMetadata | null;
}

export interface TokenMeta {
    name: string;
    symbol: string;
    uri: string;
    mutable: boolean;
    updateAuthority: string;
}

export interface TopHolder {
    address: string;
    amount: string;
    decimals: number;
    pct: number;
    uiAmount: number;
    uiAmountString: string;
    owner: string;
    insider: boolean;
}

export interface Risk {
    name: string;
    value: string;
    description: string;
    score: number;
    level: string;
}

export interface MintAccount {
    mintAuthority: string | null;
    supply: number;
    decimals: number;
    isInitialized: boolean;
    freezeAuthority: string | null;
}

export interface LiquidityAccount {
    mint: string;
    owner: string;
    amount: number;
    delegate: string | null;
    state: number;
    delegatedAmount: number;
    closeAuthority: string | null;
}

export interface LP {
    baseMint: string;
    quoteMint: string;
    lpMint: string;
    quotePrice: number;
    basePrice: number;
    base: number;
    quote: number;
    reserveSupply: number;
    currentSupply: number;
    quoteUSD: number;
    baseUSD: number;
    pctReserve: number;
    pctSupply: number;
    holders: number | null;
    totalTokensUnlocked: number;
    tokenSupply: number;
    lpLocked: number;
    lpUnlocked: number;
    lpLockedPct: number;
    lpLockedUSD: number;
    lpMaxSupply: number;
    lpCurrentSupply: number;
    lpTotalSupply: number;
}

export interface Market {
    pubkey: string;
    marketType: string;
    mintA: string;
    mintB: string;
    mintLP: string;
    liquidityA: string;
    liquidityB: string;
    mintAAccount: MintAccount;
    mintBAccount: MintAccount;
    mintLPAccount: MintAccount;
    liquidityAAccount: LiquidityAccount;
    liquidityBAccount: LiquidityAccount;
    lp: LP;
}

export interface KnownAccount {
    name: string;
    type: string;
}

export interface Event {
    event: number;
    oldValue: string;
    newValue: string;
    createdAt: string;
}

export interface VerificationLink {
    provider: string;
    value: string;
}

export interface Verification {
    mint: string;
    payer: string;
    name: string;
    symbol: string;
    description: string;
    jup_verified: boolean;
    jup_strict: boolean;
    links: VerificationLink[];
}

export interface InsiderNetwork {
    id: string;
    size: number;
    type: string;
    tokenAmount: string;
    activeAccounts: number;
}

export interface FileMeta {
    description: string;
    name: string;
    symbol: string;
    image: string;
}

export interface TransferFee {
    pct: number;
    maxAmount: number;
    authority: string;
}

export interface ReportResponse {
    mint: string;
    tokenProgram: string;
    creator: string;
    token: TokenAccount;
    token_extensions: TokenExtension;
    tokenMeta: TokenMeta;
    topHolders: TopHolder[];
    freezeAuthority: string | null;
    mintAuthority: string | null;
    risks: Risk[];
    score: number;
    score_normalised: number;
    fileMeta: FileMeta;
    lockerOwners: Record<string, unknown>;
    lockers: Record<string, unknown>;
    markets: Market[];
    totalMarketLiquidity: number;
    totalLPProviders: number;
    totalHolders: number;
    price: number;
    rugged: boolean;
    tokenType: string;
    transferFee: TransferFee;
    knownAccounts: Record<string, KnownAccount>;
    events: Event[];
    verification: Verification;
    graphInsidersDetected: number;
    insiderNetworks: InsiderNetwork[];
    detectedAt: string;
    creatorTokens: string[] | null;
}

// Insider Graph Endpoint
export interface Node {
    id: string;
    participant: boolean;
    holdings: number;
}

export interface Link {
    source: string;
    target: string;
}

export interface InsiderGraphNetwork {
    net_id: string;
    network_type: string;
    nodes: Node[];
    links: Link[];
    relatedMint: string | null;
}

export interface InsiderGraphResponse {
    networks: InsiderGraphNetwork[];
}
