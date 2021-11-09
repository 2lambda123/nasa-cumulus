// Utility functions to help with S3 multi-part uploads

import range from 'lodash/range';
import { s3 } from '../services';

export interface CompleteMultipartUploadOutput extends AWS.S3.CompleteMultipartUploadOutput {
  ETag: string
}

type Chunk = {
  start: number,
  end: number
};

const MB = 1024 * 1024;

/**
 * Each part of a multi-part copy needs to specify a byte range to be copied.
 * This byte range has a starting byte and an ending byte (inclusive) that makes
 * up the part. The maximum allowed chunk size is 5368709120 bytes.
 *
 * This function takes a file size and an optional maxSize. It returns an array
 * of objects, each containing a `start` and an `end` value. These will make up
 * the ranges of the multi-part copy.
 *
 * From anecdotal testing, a chunk size of 250 MB seems to perform fairly well.
 *
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_UploadPartCopy.html
 *
 * @param {number} objectSize - size of the object
 * @param {number} chunkSize - chunk size of the S3 multipart uploads
 * @returns {Promise<Array<Chunk>>} - array of chunks
 */
export const createMultipartChunks = (
  objectSize: number,
  chunkSize = 250 * MB
): Chunk[] =>
  range(0, objectSize, chunkSize)
    .map(
      (start) => ({
        start,
        end: Math.min(start + chunkSize, objectSize) - 1,
      })
    );

export const createMultipartUpload = async (
  params: AWS.S3.CreateMultipartUploadRequest
) => await s3().createMultipartUpload(params).promise();

export const completeMultipartUpload = async (
  params: AWS.S3.CompleteMultipartUploadRequest
): Promise<CompleteMultipartUploadOutput> => {
  const result = await s3().completeMultipartUpload(params).promise();

  return <CompleteMultipartUploadOutput>result;
};

export const abortMultipartUpload = async (
  params: AWS.S3.AbortMultipartUploadRequest
) => await s3().abortMultipartUpload(params).promise();

export const uploadPartCopy = async (
  params: AWS.S3.UploadPartCopyRequest
) => await s3().uploadPartCopy(params).promise();
