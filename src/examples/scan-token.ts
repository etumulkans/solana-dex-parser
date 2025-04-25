import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = '46YpPtajfMphoEG1vh2rkLcAyhBRQ3zSt1NDVu1UV1Hn';
  const scanner = new TokenScanner(TOKEN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);
