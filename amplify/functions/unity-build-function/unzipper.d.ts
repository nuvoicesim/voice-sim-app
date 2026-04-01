declare module "unzipper" {
  interface ZipEntry extends NodeJS.ReadableStream {
    path: string;
    type: "File" | "Directory" | string;
    autodrain(): void;
  }

  const unzipper: {
    Parse(options?: { forceStream?: boolean }): NodeJS.ReadWriteStream & AsyncIterable<ZipEntry>;
  };

  export default unzipper;
}
