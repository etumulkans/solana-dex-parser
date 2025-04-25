import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = '5FGiPVb9RK6Xz9a6qiEVYaCFmteSzcp9SB73pD8AHAvg';
  //      Ht5BNRYc1ho2vi6a82TR8fngSC268MRncVFqcW3LZY3g //2TBpuWr1at8wu7edguKebFVV9BrvbuMjTRwp34H38SV8
  const SCAN_ADDRESS = '2oiSu4BSXJ6BB99WXpZRghR4JXzbGF5oLAiRxAReAXqi';
  const scanner = new TokenScanner(TOKEN_ADDRESS, SCAN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
