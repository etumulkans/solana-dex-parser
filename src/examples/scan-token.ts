import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = '8wxqW3Twx3vXGn21j4VqEbNngEK9DT2eZ1ajhRfhpump';
  const scanner = new TokenScanner(TOKEN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
