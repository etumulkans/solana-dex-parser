import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = 'HoXsg7Q1GieX1RGADz8bQS4GRjyQgTqVSwk1BdrGw4Ge';
  //      Ht5BNRYc1ho2vi6a82TR8fngSC268MRncVFqcW3LZY3g //2TBpuWr1at8wu7edguKebFVV9BrvbuMjTRwp34H38SV8
  const SCAN_ADDRESS = '5pDFVi5RuwXBuyMMj8nV7KbZMicmR3n2iW7VpfWEiniZ';
  const scanner = new TokenScanner(TOKEN_ADDRESS, SCAN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
