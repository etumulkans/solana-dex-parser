import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = 'DgeytPxZ5aMHcXvYkLP1Lqa8BdKC3wRmo5zczwxMpump';
  const scanner = new TokenScanner(TOKEN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
