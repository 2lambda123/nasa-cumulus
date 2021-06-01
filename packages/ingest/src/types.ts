export interface ProviderClientListItem {
  name: string,
  path: string | undefined,
  size: number,
  time: number
}

export interface FtpProviderClientListItem extends ProviderClientListItem {
  type: number
}

export interface S3ProviderClientListItem extends ProviderClientListItem {
}

export interface ProviderClient {
  connect(): Promise<void>

  end(): Promise<void>

  download(
    params: {
      remotePath: string,
      localPath: string,
      remoteAltBucket?: string,
    }
  ): Promise<string>

  list(path: string): Promise<ProviderClientListItem[]>

  sync(
    params: {
      fileRemotePath: string,
      destinationBucket: string,
      destinationKey: string,
      bucket?: string,
    }
  ): Promise<{s3uri: string, etag: string}>
}
