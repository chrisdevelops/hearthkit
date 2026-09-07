import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

/**
 * The storage section, end to end: pick a file, upload it, see it listed, fetch it back.
 *
 * The point of the section is what it does NOT do. The bytes never reach this app's server: the page
 * asks a route handler for a presigned upload URL and `PUT`s straight to storage, then asks for a
 * presigned download URL and reads the object back. That is @hearthkit/storage's whole reason to
 * exist, so the section demonstrates it rather than hiding it behind a form post.
 *
 * Needs MinIO (or any S3-compatible endpoint) reachable at whatever STORAGE_ENDPOINT the running app
 * was configured with, and the bucket to exist. `hearthkit dev infra up` starts both.
 *
 * The file is supplied in memory through setInputFiles' payload form, so nothing binary is committed
 * and e2e/ gains no fixture directory.
 */

/** A run-unique token, so two runs against the same bucket cannot see each other's objects. */
const uploadRunToken = randomUUID().replaceAll('-', '').slice(0, 12)

/** The file this run uploads: unique name, unique bytes, small enough to compare in full. */
const uploadedFileName = `hearthkit-storage-flow-${uploadRunToken}.txt`
const uploadedFileBytes = `hearthkit storage flow ${uploadRunToken}\n`

test('a file uploaded from the browser is listed and comes back byte for byte', async ({
  page,
  request,
}) => {
  const response = await page.goto('/storage')
  expect(response?.status()).toBe(200)

  await page.getByTestId('storage-file-input').setInputFiles({
    name: uploadedFileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(uploadedFileBytes, 'utf8'),
  })
  await page.getByRole('button', { name: 'Upload' }).click()

  // The listing is what proves the object reached storage rather than a buffer in the app.
  const uploadedObject = page.getByTestId('stored-object').filter({ hasText: uploadedFileName })
  await expect(uploadedObject).toBeVisible({ timeout: 30_000 })

  // The download link is a presigned URL: it carries its own credentials, so fetching it with a
  // request context that has none of the page's cookies is the assertion that it really is signed.
  const downloadUrl = await uploadedObject
    .getByTestId('stored-object-download-url')
    .getAttribute('href')
  expect(
    downloadUrl,
    'the section must presign a download URL for the object it listed',
  ).not.toBeNull()
  expect(downloadUrl ?? '').toContain('http')

  const downloaded = await request.get(downloadUrl ?? '')
  expect(downloaded.status()).toBe(200)
  expect(await downloaded.text()).toBe(uploadedFileBytes)
})
