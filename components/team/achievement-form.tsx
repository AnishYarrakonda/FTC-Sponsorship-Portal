'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { achievementSchema, type AchievementInput } from '@/lib/schemas/achievement'
import { addAchievement } from '@/app/actions/team'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { describeActionError } from '@/lib/client-errors'

export function AchievementForm({ teamId }: { teamId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const router = useRouter()

  const form = useForm<AchievementInput>({
    resolver: zodResolver(achievementSchema),
    defaultValues: {
      season: '',
      eventName: '',
      award: '',
      description: '',
    },
  })

  async function onSubmit(values: AchievementInput) {
    setIsPending(true)
    setError(null)
    try {
      const result = await addAchievement(teamId, values)
      if (result?.error) {
        setError(result.error)
        setIsPending(false)
        return
      }
      router.push('/dashboard')
    } catch (e) {
      setError(describeActionError(e, 'addAchievement'))
      setIsPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Achievement</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="season"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Season</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 2024-25" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="award"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Award (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Inspire Award" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="eventName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Texas Regional Championship" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe what made this achievement significant..."
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving...' : 'Add Achievement'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push('/dashboard')}>
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
