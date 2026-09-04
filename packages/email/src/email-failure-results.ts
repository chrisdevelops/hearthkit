import {
  emailRecipientInvalidErrorPrefix,
  emailSendFailedErrorPrefix,
  emailTemplateRenderFailedErrorPrefix,
  emailTransportConfigIncompleteErrorPrefix,
  emailTransportRejectedErrorPrefix,
  emailTransportUnreachableErrorPrefix,
  type EmailFailure,
  type EmailTemplateName,
  type EmailTransportName,
} from './email-contract.ts'

// The RFC 5321 maximum length of an address path. A recipient longer than this is already invalid, so
// the failure keeps only this much of it and a hostile value cannot blow up a log line.
const maximumReportedRecipientLength = 320

/** One arm of the returned failure union, picked by kind, so every constructor below is checked against the contract shape. */
type EmailFailureOf<TKind extends EmailFailure['kind']> = Extract<EmailFailure, { kind: TKind }>

/** EMAIL_TRANSPORT named a transport whose variables are not all set; every missing name is listed on its own line. */
export function emailTransportConfigIncompleteFailure(
  emailTransportName: EmailTransportName,
  missingVariableNames: readonly string[],
): EmailFailureOf<'email-transport-config-incomplete'> {
  const listedVariableNames = missingVariableNames
    .map((variableName) => `  ${variableName} is unset`)
    .join('\n')
  return {
    kind: 'email-transport-config-incomplete',
    emailTransportName,
    missingVariableNames: [...missingVariableNames],
    message: `${emailTransportConfigIncompleteErrorPrefix} EMAIL_TRANSPORT=${emailTransportName} still needs\n${listedVariableNames}`,
  }
}

/** The `to` string is not one valid mailbox; produced before any transport is contacted, so nothing was sent. */
export function emailRecipientInvalidFailure(
  recipientValue: string,
): EmailFailureOf<'email-recipient-invalid'> {
  const reportedRecipientValue = recipientValue.slice(0, maximumReportedRecipientLength)
  return {
    kind: 'email-recipient-invalid',
    recipientValue: reportedRecipientValue,
    message: `${emailRecipientInvalidErrorPrefix} to must be exactly one mailbox with no display name, received ${JSON.stringify(reportedRecipientValue)}`,
  }
}

/** The template threw while building or rendering, or built a subject emailSubjectSchema rejects. */
export function emailTemplateRenderFailedFailure(
  emailTemplateName: EmailTemplateName,
  renderFailureDetail: string,
): EmailFailureOf<'email-template-render-failed'> {
  return {
    kind: 'email-template-render-failed',
    emailTemplateName,
    renderFailureDetail,
    message: `${emailTemplateRenderFailedErrorPrefix} ${emailTemplateName} could not be rendered: ${renderFailureDetail}`,
  }
}

/** The transport was never usable: refused, unresolved, timed out, or unable to upgrade to TLS, so no message was seen. */
export function emailTransportUnreachableFailure(
  emailTransportName: EmailTransportName,
  transportErrorCode: string,
  transportTarget: string,
  detail: string,
): EmailFailureOf<'email-transport-unreachable'> {
  return {
    kind: 'email-transport-unreachable',
    emailTransportName,
    transportErrorCode,
    transportTarget,
    message: `${emailTransportUnreachableErrorPrefix} ${emailTransportName} at ${transportTarget} answered ${transportErrorCode}: ${detail}`,
  }
}

/** The transport was reached and refused the session or the message; carries the code and status it reported. */
export function emailTransportRejectedFailure(
  emailTransportName: EmailTransportName,
  transportErrorCode: string,
  transportStatusCode: number | undefined,
  detail: string,
): EmailFailureOf<'email-transport-rejected'> {
  return {
    kind: 'email-transport-rejected',
    emailTransportName,
    transportErrorCode,
    transportStatusCode,
    message: `${emailTransportRejectedErrorPrefix} ${emailTransportName} refused the message with ${transportErrorCode}${transportStatusCode === undefined ? '' : ` and status ${transportStatusCode}`}: ${detail}`,
  }
}

/** Anything this package cannot classify; it exists so no call ever throws instead of returning a value. */
export function emailSendFailedFailure(
  emailTransportName: EmailTransportName,
  sendFailureDetail: string,
): EmailFailureOf<'email-send-failed'> {
  return {
    kind: 'email-send-failed',
    emailTransportName,
    sendFailureDetail,
    message: `${emailSendFailedErrorPrefix} ${emailTransportName} failed in a way this package does not name: ${sendFailureDetail}`,
  }
}
