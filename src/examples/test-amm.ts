import { TokenScanner } from '../scanner/amm-grpc-test';

async function main() {
  const TOKEN_ADDRESS = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
  //      Ht5BNRYc1ho2vi6a82TR8fngSC268MRncVFqcW3LZY3g //2TBpuWr1at8wu7edguKebFVV9BrvbuMjTRwp34H38SV8
  const SCAN_ADDRESS = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
  const scanner = new TokenScanner(TOKEN_ADDRESS, SCAN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
