'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CheckCircle, AlertTriangle, UploadCloud } from 'lucide-react'
import { uploadW9 } from '@/app/actions/payout'
import { describeActionError } from '@/lib/client-errors'

type Props = {
  teamId: string
  hasExistingW9: boolean
  isVerified: boolean
  rejectedReason: string | null
}

export function UploadW9Client({ teamId, hasExistingW9, isVerified, rejectedReason }: Props) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Please select a file.')
      return
    }

    setIsPending(true)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const result = await uploadW9(teamId, formData)
      if (result?.error) {
        setError(result.error)
        setIsPending(false)
        return
      }
      router.push('/dashboard?tab=portfolio')
      router.refresh()
    } catch (err) {
      setError(describeActionError(err, 'uploadW9'))
      setIsPending(false)
    }
  }

  if (isVerified) {
    return (
      <Alert className="bg-emerald-500/10 border-emerald-500/20 text-emerald-700">
        <CheckCircle className="h-4 w-4" />
        <AlertTitle>W-9 Verified</AlertTitle>
        <AlertDescription>
          Your W-9 has been verified and is on file. Sponsors can now send payouts to your team.
          You do not need to re-upload unless your tax information changes.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {hasExistingW9 && !rejectedReason && (
        <Alert className="bg-amber-500/10 border-amber-500/20 text-amber-700">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Under Review</AlertTitle>
          <AlertDescription>
            You have already uploaded a W-9 and it is currently being reviewed.
            Uploading a new one will replace it.
          </AlertDescription>
        </Alert>
      )}

      {rejectedReason && (
        <Alert variant="destructive" className="bg-red-500/10 text-red-600 border-red-500/20">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>W-9 Rejected</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {rejectedReason}
            <br /><br />
            Please fix the issue and upload a corrected W-9 below.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleUpload} className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="w9-upload">Signed W-9 Document (PDF only)</Label>
          <Input
            id="w9-upload"
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null)
              setError(null)
            }}
            disabled={isPending}
          />
          <p className="text-xs text-muted-foreground">
            Max file size: 5MB. Must be a signed PDF form.
          </p>
        </div>

        <Button type="submit" disabled={!file || isPending} className="w-full">
          {isPending ? 'Uploading...' : 'Upload Document'}
          <UploadCloud className="w-4 h-4 ml-2" />
        </Button>
      </form>
    </div>
  )
}
