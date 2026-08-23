'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { UploadCloud, CheckCircle2, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { uploadCredentials } from '@/app/actions/credentials'
import { toast } from 'sonner'

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

export default function UploadCredentialsPage() {
  const [file, setFile] = useState<File | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    // Quick client-side pre-checks for fast feedback; the server action is the
    // real gate (size + MIME allowlist + magic-byte sniffing).
    if (selected.size > MAX_SIZE) {
      toast.error('File too large (max 5MB)')
      return
    }
    if (!ALLOWED_TYPES.includes(selected.type)) {
      toast.error('Only PDF, JPG, or PNG files are accepted')
      return
    }
    setFile(selected)
    setError(null)
  }

  const handleUpload = () => {
    if (!file || isPending) return
    setError(null)
    startTransition(async () => {
      const formData = new FormData()
      formData.append('credentialFile', file)
      const result = await uploadCredentials(formData)

      if (result.error) {
        setError(result.error)
        toast.error('Upload failed')
        return
      }

      setIsSuccess(true)
      toast.success('Credentials uploaded successfully!')
      setTimeout(() => {
        router.push('/awaiting-verification')
        router.refresh()
      }, 2000)
    })
  }

  if (isSuccess) {
    return (
      <div className="container mx-auto max-w-md py-20">
        <Card className="text-center">
          <CardContent className="pt-10 pb-10 space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <CardTitle>Upload Complete</CardTitle>
            <CardDescription>
              Your credentials have been uploaded and are ready for review.
              Redirecting you back...
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-md py-20">
      <Link
        href="/awaiting-verification"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ChevronLeft className="mr-1 h-4 w-4" /> Back to status
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Upload Coach Credentials</CardTitle>
          <CardDescription>
            Please upload a photo of your school ID, faculty badge, or a signed letter from your administration to verify your role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* A-08-01 / B-04-16. This was a <div onClick> with the real <input type="file">
              hidden by `className="hidden"`. display:none removes an element from the tab
              order entirely, so the page had exactly ONE tab stop and a keyboard-only
              coach could never reach the control that uploads their ID — the mandatory
              step of onboarding.

              A <label> is the fix rather than tabIndex/role/onKeyDown on the div: the
              label makes the whole area clickable, `sr-only` keeps the input in the tab
              order and announced with its accessible name, and focus-within paints the
              ring on the visible box instead of on an invisible input. */}
          <label
            htmlFor="credential-file"
            className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-border rounded-xl bg-background/50 hover:bg-accent transition-colors cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
            aria-disabled={isPending}
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <UploadCloud className="w-10 h-10 text-muted-foreground mb-2" aria-hidden="true" />
              <p className="text-sm text-muted-foreground px-4 text-center">
                {file ? (
                  <span className="font-semibold text-foreground">{file.name}</span>
                ) : (
                  <span>Click to select or drag and drop<br />PDF, JPG, or PNG (Max 5MB)</span>
                )}
              </p>
            </div>
            <input
              id="credential-file"
              type="file"
              ref={fileInputRef}
              className="sr-only"
              accept=".pdf,image/jpeg,image/png"
              onChange={handleFileChange}
              disabled={isPending}
            />
          </label>
          {/* Announced on selection: a sighted user sees the filename replace the prompt,
              a screen-reader user previously got nothing at all. */}
          <p id="credential-file-status" className="sr-only" role="status" aria-live="polite">
            {file ? `Selected file: ${file.name}` : 'No file selected'}
          </p>
        </CardContent>
        <CardFooter>
          {/* B-04-16. `disabled` also removes the button from the tab order, so a
              keyboard user who could not reach the file input met a page with ONE tab
              stop and no way to progress. The dropzone fix above is what unblocks that;
              aria-describedby is what explains the remaining disabled state instead of
              leaving it unexplained. */}
          <Button
            className="w-full"
            aria-describedby="credential-file-status"
            disabled={!file || isPending}
            loading={isPending}
            onClick={handleUpload}
          >
            {isPending ? 'Uploading…' : 'Submit for review'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
