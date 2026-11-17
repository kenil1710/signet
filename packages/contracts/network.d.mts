export interface SignetNetwork {
  name: 'mainnet' | 'local';
  chainId: number;
  rpcUrl: string;
  rpcUrl2?: string;
  forkOf?: string;
  forkBlock?: number;
  contracts: { registry?: string; factory?: string; gateImplementation?: string };
  gates: Record<string, { address?: string; domain?: string; prefix?: string }>;
  tapeout: {
    processor: string; policyCircuitId: number; circuitBeacon: string; circuitImplementation: string;
    processorCodehash: string; siteRegistry: string; containerOpener: string; sharedCircuitId: number; sharedContainer: string;
    guardCircuitId?: number; // the Guard decision circuit (absent until it is taped out on this network)
  };
  accounts?: { deployer: string; approvers: string[]; proposer: string; recovery: string; guardian: string; users: string[] };
}
export function loadNetwork(name?: string): SignetNetwork;
