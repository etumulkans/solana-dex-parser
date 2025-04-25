import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  const scanner = new TokenScanner(TOKEN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
