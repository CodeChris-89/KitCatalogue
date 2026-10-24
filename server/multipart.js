/**
 * Minimal, dependency-free multipart/form-data parser for Node.js http IncomingMessage.
 * Supports multiple files and text fields up to maxBytes.
 */

function parseMultipart(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) {
      return reject(new Error('Missing multipart boundary'));
    }
    const boundary = match[1] || match[2];
    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const crlf = Buffer.from('\r\n\r\n');

    const chunks = [];
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        req.destroy();
        reject(new Error(`Upload exceeds maximum allowed size (${Math.round(maxBytes / 1024 / 1024)}MB)`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', (err) => reject(err));

    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fields = {};
        const files = [];

        let pos = buffer.indexOf(boundaryBuffer);
        while (pos !== -1) {
          pos += boundaryBuffer.length;
          // Check if closing boundary '--'
          if (buffer[pos] === 45 && buffer[pos + 1] === 45) {
            break;
          }
          // Skip leading \r\n
          if (buffer[pos] === 13 && buffer[pos + 1] === 10) {
            pos += 2;
          }

          const nextBoundary = buffer.indexOf(boundaryBuffer, pos);
          if (nextBoundary === -1) break;

          // Part data ends 2 bytes (\r\n) before nextBoundary
          const partEnd = nextBoundary - 2;
          const headerEnd = buffer.indexOf(crlf, pos);
          if (headerEnd !== -1 && headerEnd < partEnd) {
            const headerStr = buffer.subarray(pos, headerEnd).toString('utf8');
            const bodyBuf = buffer.subarray(headerEnd + 4, partEnd);

            const nameMatch = headerStr.match(/name="([^"]+)"/i);
            const filenameMatch = headerStr.match(/filename="([^"]*)"/i);
            const contentTypeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

            const fieldName = nameMatch ? nameMatch[1] : 'unknown';

            if (filenameMatch && filenameMatch[1]) {
              files.push({
                fieldName,
                originalName: filenameMatch[1],
                mimeType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
                buffer: bodyBuf,
                size: bodyBuf.length
              });
            } else {
              fields[fieldName] = bodyBuf.toString('utf8');
            }
          }

          pos = nextBoundary;
        }

        resolve({ fields, files });
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = { parseMultipart };
