'use client'

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageContainer,
  PageHeader,
} from '@hearthkit/ui'
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'

/**
 * The `@hearthkit/storage` section: pick a file, upload it, see it listed, fetch it back.
 *
 * The point of this page is what it does NOT do. The bytes never reach this app's server: it asks a
 * route handler for a presigned upload URL and `PUT`s straight to the object store, then asks for a
 * presigned download URL and links to that. Keep it that way when you adapt it — routing uploads
 * through a server action would put every megabyte through your own process for nothing.
 *
 * A browser component rather than a server one, so the file stays a real `File` in the page. That is
 * also why every value it shows comes from `/api/storage/*` rather than from config: a client
 * component can read neither, and it should not.
 */

/** Never prerendered: the route segment config is stated for every section page and handler alike. */
export const dynamic = 'force-dynamic'

/** One row of the listing, with the download URL this page presigned for it. */
type StoredObjectRow = {
  storageObjectKey: string
  objectByteCount: number
  presignedDownloadUrl: string
}

/** True for a JSON object, which is the only shape this page reads a route's answer as; only the fields it renders are read. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The string-valued entries of a JSON object, which is what a signed request's headers must be; anything else is left out. */
function stringEntriesOf(value: unknown): Record<string, string> {
  const stringEntries: Record<string, string> = {}
  if (!isJsonObject(value)) {
    return stringEntries
  }
  for (const [entryName, entryValue] of Object.entries(value)) {
    if (typeof entryValue === 'string') {
      stringEntries[entryName] = entryValue
    }
  }
  return stringEntries
}

/** The message a non-2xx section route carries; it is the owning package's own, so it is shown unchanged. */
async function failureMessageOf(response: Response): Promise<string> {
  const bodyText = await response.text()
  try {
    const parsed: unknown = JSON.parse(bodyText)
    return isJsonObject(parsed) && typeof parsed.message === 'string' ? parsed.message : bodyText
  } catch {
    return bodyText
  }
}

export default function StorageSectionPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [storedObjectRows, setStoredObjectRows] = useState<StoredObjectRow[]>([])
  const [sectionMessage, setSectionMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const refreshStoredObjects = useCallback(async (): Promise<void> => {
    const listResponse = await fetch('/api/storage/objects', { cache: 'no-store' })
    if (!listResponse.ok) {
      setSectionMessage(await failureMessageOf(listResponse))
      return
    }
    const listed: unknown = await listResponse.json()
    const storedObjects: readonly unknown[] =
      isJsonObject(listed) && Array.isArray(listed.storedObjects) ? listed.storedObjects : []

    // One presigned download per listed object. Fine for a bucket a person is looking at, and the
    // honest shape: a download URL carries its own credentials, so it cannot be built in the browser.
    const rows: StoredObjectRow[] = []
    for (const storedObject of storedObjects) {
      if (!isJsonObject(storedObject) || typeof storedObject.storageObjectKey !== 'string') {
        continue
      }
      const downloadResponse = await fetch('/api/storage/download-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objectKey: storedObject.storageObjectKey }),
      })
      if (!downloadResponse.ok) {
        continue
      }
      const signed: unknown = await downloadResponse.json()
      if (!isJsonObject(signed) || typeof signed.presignedDownloadUrl !== 'string') {
        continue
      }
      rows.push({
        storageObjectKey: storedObject.storageObjectKey,
        objectByteCount:
          typeof storedObject.objectByteCount === 'number' ? storedObject.objectByteCount : 0,
        presignedDownloadUrl: signed.presignedDownloadUrl,
      })
    }
    setStoredObjectRows(rows)
  }, [])

  const uploadSelectedFile = useCallback(async (): Promise<void> => {
    if (selectedFile === null) {
      setSectionMessage('Choose a file first.')
      return
    }

    setIsBusy(true)
    setSectionMessage('')
    try {
      const signResponse = await fetch('/api/storage/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          objectKey: selectedFile.name,
          contentType: selectedFile.type === '' ? 'application/octet-stream' : selectedFile.type,
        }),
      })
      if (!signResponse.ok) {
        setSectionMessage(await failureMessageOf(signResponse))
        return
      }
      const signed: unknown = await signResponse.json()
      if (!isJsonObject(signed) || typeof signed.presignedUploadUrl !== 'string') {
        setSectionMessage('The upload signer answered without a URL.')
        return
      }

      // Straight from the browser to the object store. The signed headers must be sent verbatim,
      // because the content type is inside the signature.
      const uploadResponse = await fetch(signed.presignedUploadUrl, {
        method: 'PUT',
        headers: stringEntriesOf(signed.requiredRequestHeaders),
        body: selectedFile,
      })
      if (!uploadResponse.ok) {
        setSectionMessage(
          `The object store refused the upload with ${String(uploadResponse.status)}.`,
        )
        return
      }

      await refreshStoredObjects()
      setSectionMessage(`Uploaded ${selectedFile.name}.`)
    } finally {
      setIsBusy(false)
    }
  }, [refreshStoredObjects, selectedFile])

  useEffect(() => {
    void refreshStoredObjects()
  }, [refreshStoredObjects])

  return (
    <PageContainer>
      <PageHeader
        pageTitle="Storage"
        pageDescription="Upload a file straight from this page to object storage, then read it back through a presigned URL."
      />

      <Card>
        <CardHeader>
          <CardTitle>Upload a file</CardTitle>
          <CardDescription>
            The file goes from your browser to the object store. This server only signs the URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <input
            type="file"
            data-testid="storage-file-input"
            className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1 file:text-sm"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setSelectedFile(event.target.files?.[0] ?? null)
            }}
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={isBusy}
              onClick={() => {
                void uploadSelectedFile()
              }}
            >
              Upload
            </Button>
            <p data-testid="storage-message" className="text-sm text-muted-foreground">
              {sectionMessage}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>In the bucket</CardTitle>
          <CardDescription>
            One page of keys, each with a download URL signed for this visit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {storedObjectRows.map((storedObjectRow) => (
              <li
                key={storedObjectRow.storageObjectKey}
                data-testid="stored-object"
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span className="truncate">{storedObjectRow.storageObjectKey}</span>
                <a
                  data-testid="stored-object-download-url"
                  href={storedObjectRow.presignedDownloadUrl}
                  className="shrink-0 underline"
                >
                  Download {String(storedObjectRow.objectByteCount)} bytes
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
