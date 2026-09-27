import { LifecycleError } from '@open-fms/lifecycle';
import { defineHandler, defineRouteMeta } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { resolveDownloadCredentials } from '~/server/downloads/credentials.ts';
import { openDownload } from '~/server/downloads/service.ts';

defineRouteMeta({
  openAPI: {
    tags: ['files'],
    summary: 'Download file content',
    description:
      'Proxies bytes from the clean bucket. Only clean files are downloadable. Supports Range.',
    parameters: [
      {
        in: 'header',
        name: 'range',
        description: 'HTTP byte range, for example bytes=0-1023',
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: { description: 'Full object stream' },
      206: { description: 'Partial content' },
      403: { description: 'Not downloadable (capability or status)' },
      404: { description: 'File not found' },
    },
  },
});

export default defineHandler(async (event) => {
  const caller = event.context.caller;
  const fileId = event.context.params?.id;
  if (!caller) {
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  }
  if (!fileId) {
    throw new HTTPError('ROUTE_PARAM_MISSING', { status: 400 });
  }

  const rangeHeader = event.req.headers.get('range') ?? undefined;

  try {
    const download = await openDownload(
      {
        fileId,
        callerId: caller.caller.id,
        allowDirectDownload: caller.caller.allowDirectDownload,
        rangeHeader,
      },
      resolveDownloadCredentials(),
    );

    const headers = new Headers();
    headers.set('etag', download.etag);
    headers.set('accept-ranges', 'bytes');
    if (download.contentLength !== undefined) {
      headers.set('content-length', String(download.contentLength));
    }
    if (download.contentRange) {
      headers.set('content-range', download.contentRange);
    }
    if (download.contentType) {
      headers.set('content-type', download.contentType);
    }
    headers.set(
      'content-disposition',
      `attachment; filename="${download.filename.replaceAll('"', '')}"`,
    );

    return new Response(download.body, {
      status: download.contentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    if (error instanceof LifecycleError) {
      const status =
        error.code === 'FILE_NOT_FOUND' ? 404 : error.code === 'FILE_NOT_DOWNLOADABLE' ? 403 : 400;
      throw new HTTPError(error.code, { status });
    }
    throw new HTTPError('DOWNLOAD_FAILED', { status: 500 });
  }
});
