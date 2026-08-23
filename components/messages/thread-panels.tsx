'use client'

/**
 * Surface-specific wrappers around <MessageThread />.
 *
 * These exist because a Server Component cannot hand a Client Component an arbitrary
 * closure — only a server action reference — so each surface needs a small client shim that
 * imports its own action and closes over the submission id (or token).
 */

import { MessageThread, CoachComposerWarning, type ThreadMessage } from './thread'
import {
  postCoachReply,
  postSponsorQuestion,
  postSponsorQuestionByToken,
  reportSubmissionMessage,
} from '@/app/actions/messages'

export function CoachThreadPanel({
  submissionId,
  messages,
  canCompose,
  hasSponsorMessage,
  sponsorName,
  closedNotice,
}: {
  submissionId: string
  messages: ThreadMessage[]
  canCompose: boolean
  hasSponsorMessage: boolean
  sponsorName: string
  closedNotice?: string
}) {
  return (
    <MessageThread
      messages={messages}
      viewerRole="coach"
      // A coach can never open a thread — the composer does not exist until the sponsor
      // has asked something. Enforced in the DB trigger too; this is the UI half.
      canCompose={canCompose && hasSponsorMessage}
      composerWarning={<CoachComposerWarning />}
      /* P3: this sentence was passed as BOTH closedNotice and emptyState, so the coach's
         submission page printed it twice in a row. emptyState already covers "there are no
         messages"; closedNotice is for "and you cannot add one", which only needs saying
         when a caller supplies a specific reason. */
      closedNotice={closedNotice}
      emptyState={`No questions yet. If ${sponsorName} has one, it will appear here.`}
      description={`Questions from ${sponsorName}, and your replies. Our team reviews every reply before it is sent.`}
      onSubmit={(body) => postCoachReply({ submissionId, body })}
      onReport={(messageId, reason) => reportSubmissionMessage({ messageId, reason })}
    />
  )
}

export function SponsorThreadPanel({
  submissionId,
  messages,
  canCompose,
  teamName,
}: {
  submissionId: string
  messages: ThreadMessage[]
  canCompose: boolean
  teamName: string
}) {
  return (
    <MessageThread
      messages={messages}
      viewerRole="sponsor"
      canCompose={canCompose}
      emptyState={`Have a question before you decide? Ask ${teamName}'s coach here.`}
      closedNotice="This proposal is no longer awaiting your decision, so the conversation is read-only."
      description="Ask the coach anything you need before deciding. Replies are reviewed by our team before they reach you."
      onSubmit={(body) => postSponsorQuestion({ submissionId, body })}
    />
  )
}

export function TokenThreadPanel({
  token,
  messages,
  canCompose,
  teamName,
}: {
  token: string
  messages: ThreadMessage[]
  canCompose: boolean
  teamName: string
}) {
  return (
    <MessageThread
      messages={messages}
      viewerRole="sponsor"
      canCompose={canCompose}
      emptyState={`Have a question before you decide? Ask ${teamName}'s coach here.`}
      closedNotice="This proposal is no longer awaiting your decision, so the conversation is read-only."
      description="Asking a question does not use up your decision link — you can still approve or decline afterwards."
      onSubmit={(body) => postSponsorQuestionByToken({ token, body })}
    />
  )
}
