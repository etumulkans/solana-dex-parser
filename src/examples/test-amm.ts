import { TokenScanner } from '../scanner/amm-grpc-test';

async function main() {
  const TOKEN_ADDRESS = '7fUbHvZwb3Rj2BC195FwhmFBa9HUYHWZcyqHHWy5pump';
  //      Ht5BNRYc1ho2vi6a82TR8fngSC268MRncVFqcW3LZY3g //2TBpuWr1at8wu7edguKebFVV9BrvbuMjTRwp34H38SV8
  const SCAN_ADDRESS = '7fUbHvZwb3Rj2BC195FwhmFBa9HUYHWZcyqHHWy5pump';
  const scanner = new TokenScanner(TOKEN_ADDRESS, SCAN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
