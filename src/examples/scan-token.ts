import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = 'C75XLNhMMUtALZeW2YdhF5zNYNibCwodEftXfYwboZM9';
  const scanner = new TokenScanner(TOKEN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
