import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = '5AWn89bzhKrEAApUVUC3ePu3fCjetNtEbwyyt1MVBgPJ';
  const scanner = new TokenScanner(TOKEN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
