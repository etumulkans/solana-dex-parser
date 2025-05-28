import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

// Define log levels
enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  // Set the log level
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  // Create log directory if it doesn't exist
  private ensureLogDirectoryExists(filename: string): void {
    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Format the log message
  private formatMessage(level: string, message: any): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${util.format(message)}`;
  }

  // Write to file if filename is provided
  private writeToFile(formattedMessage: string, filename?: string): void {
    if (filename) {
      this.ensureLogDirectoryExists(filename);
      fs.appendFileSync(filename, formattedMessage + '\n', { encoding: 'utf8' });
    }
  }

  // Log methods
  debug(message: any, filename?: string): void {
    if (this.level >= LogLevel.DEBUG) {
      const formattedMessage = this.formatMessage('DEBUG', message);
      console.debug(formattedMessage);
      this.writeToFile(formattedMessage, filename);
    }
  }

  info(message: any, filename?: string): void {
    if (this.level >= LogLevel.INFO) {
      const formattedMessage = this.formatMessage('INFO', message);
      console.info(formattedMessage);
      this.writeToFile(formattedMessage, filename);
    }
  }

  warn(message: any, filename?: string): void {
    if (this.level >= LogLevel.WARN) {
      const formattedMessage = this.formatMessage('WARN', message);
      console.warn(formattedMessage);
      this.writeToFile(formattedMessage, filename);
    }
  }

  error(message: any, filename?: string): void {
    if (this.level >= LogLevel.ERROR) {
      const formattedMessage = this.formatMessage('ERROR', message);
      console.error(formattedMessage);
      this.writeToFile(formattedMessage, filename);
    }
  }
}

// Export a singleton instance
const logger = new Logger();
export default logger;
