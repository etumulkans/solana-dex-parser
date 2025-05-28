import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = 'HueN6T2L2gZPUoEBBodaJS6ytXXHUWnmE4ii8nKfoZjF';
  //      Ht5BNRYc1ho2vi6a82TR8fngSC268MRncVFqcW3LZY3g //2TBpuWr1at8wu7edguKebFVV9BrvbuMjTRwp34H38SV8
  const SCAN_ADDRESS = 'BhdcKQeYDQZrvyLVTktB4vFpRkh6KQCbNrsDkiWLtzn5';
  const scanner = new TokenScanner(TOKEN_ADDRESS, SCAN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
