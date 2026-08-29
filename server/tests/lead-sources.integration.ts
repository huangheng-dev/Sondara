import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { customers, customerTouchpoints, inboxContacts, leadSourceConnections, leadSourceEvents, tasks, users } from '../db/schema.js'
import { eq } from 'drizzle-orm'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const ownerEmail = `lead-owner-${suffix}@sondara.local`
  const memberEmail = `lead-member-${suffix}@sondara.local`
  let ownerId = ''
  let memberId = ''
  const connectionIds: string[] = []
  const originalFetch = globalThis.fetch
  try {
    const owner = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: '线索负责人', email: ownerEmail, password: 'LeadOwner@2026' } })
    assert.equal(owner.statusCode, 201, owner.body)
    ownerId = owner.json().user.id
    const ownerHeaders = { cookie: cookieValue(owner.headers['set-cookie']) }

    const member = await app.inject({ method: 'POST', url: '/api/admin/members', headers: ownerHeaders, payload: { displayName: '线索成员', email: memberEmail, password: 'LeadMember@2026', role: 'member' } })
    assert.equal(member.statusCode, 201, member.body)
    memberId = member.json().id
    const memberLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: memberEmail, password: 'LeadMember@2026', remember: true } })
    assert.equal(memberLogin.statusCode, 200, memberLogin.body)
    const memberHeaders = { cookie: cookieValue(memberLogin.headers['set-cookie']) }

    const forbidden = await app.inject({ method: 'POST', url: '/api/lead-sources/connections', headers: memberHeaders, payload: { name: '成员不能创建', provider: 'meta-lead-ads' } })
    assert.equal(forbidden.statusCode, 403, forbidden.body)

    const invalid = await app.inject({ method: 'POST', url: '/api/lead-sources/connections', headers: ownerHeaders, payload: { name: 'x', provider: 'unknown' } })
    assert.equal(invalid.statusCode, 400, invalid.body)

    const created = await app.inject({
      method: 'POST',
      url: '/api/lead-sources/connections',
      headers: ownerHeaders,
      payload: { name: `Meta Lead Ads ${suffix}`, provider: 'meta-lead-ads', accountRef: 'act-123', accessToken: 'meta-secret-token-value' },
    })
    assert.equal(created.statusCode, 201, created.body)
    const connection = created.json()
    connectionIds.push(connection.id)
    assert.equal(connection.hasAccessToken, true)
    assert.equal(connection.accessTokenEnding, 'ALUE')
    assert.ok(!('webhookTokenHash' in connection))
    assert.ok(!('accessTokenCiphertext' in connection))
    const webhookUrl = new URL(connection.webhookUrl)
    const token = webhookUrl.searchParams.get('token')
    assert.ok(token)

    const missingToken = await app.inject({ method: 'POST', url: webhookUrl.pathname, payload: { leadgen_id: 'lead-missing-token' } })
    assert.equal(missingToken.statusCode, 403, missingToken.body)
    const badToken = await app.inject({ method: 'POST', url: `${webhookUrl.pathname}?token=wrong`, payload: { leadgen_id: 'lead-bad-token' } })
    assert.equal(badToken.statusCode, 403, badToken.body)

    const challenge = await app.inject({ method: 'GET', url: `${webhookUrl.pathname}?token=${encodeURIComponent(token!)}&hub.challenge=CHALLENGE_OK` })
    assert.equal(challenge.statusCode, 200, challenge.body)
    assert.equal(challenge.body, 'CHALLENGE_OK')

    globalThis.fetch = (async () => new Response(JSON.stringify({ id: 'lead-001', field_data: [{ name: 'email', values: ['buyer@example.test'] }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch

    const event = await app.inject({ method: 'POST', url: webhookUrl.pathname + webhookUrl.search, payload: { leadgen_id: 'lead-001', form_id: 'form-001', entry: [{ changes: [{ field: 'leadgen' }] }] } })
    assert.equal(event.statusCode, 200, event.body)
    assert.equal(event.json().accepted, true)

    const duplicate = await app.inject({ method: 'POST', url: webhookUrl.pathname + webhookUrl.search, payload: { leadgen_id: 'lead-001', form_id: 'form-001' } })
    assert.equal(duplicate.statusCode, 200, duplicate.body)
    assert.equal(duplicate.json().duplicate, true)

    const hashedEvent = await app.inject({ method: 'POST', url: webhookUrl.pathname + webhookUrl.search, payload: { changed_fields: ['leadgen'], entry: [{ id: 'entry-hash' }], time: 1234567890 } })
    assert.equal(hashedEvent.statusCode, 200, hashedEvent.body)
    assert.equal(hashedEvent.json().accepted, true)

    const events = await app.inject({ method: 'GET', url: '/api/lead-sources/events', headers: ownerHeaders })
    assert.equal(events.statusCode, 200, events.body)
    assert.equal(events.json().items.length, 2)
    assert.ok(events.json().items.some((item: { providerEventId: string }) => item.providerEventId === 'lead-001'))

    const rotated = await app.inject({ method: 'POST', url: `/api/lead-sources/connections/${connection.id}/regenerate-webhook`, headers: ownerHeaders })
    assert.equal(rotated.statusCode, 200, rotated.body)
    const rotatedUrl = new URL(rotated.json().webhookUrl)
    const rotatedToken = rotatedUrl.searchParams.get('token')
    assert.ok(rotatedToken)
    assert.notEqual(rotatedToken, token)
    const oldTokenAfterRotation = await app.inject({ method: 'POST', url: webhookUrl.pathname + webhookUrl.search, payload: { leadgen_id: 'lead-old-token' } })
    assert.equal(oldTokenAfterRotation.statusCode, 403, oldTokenAfterRotation.body)
    const newTokenEvent = await app.inject({ method: 'POST', url: rotatedUrl.pathname + rotatedUrl.search, payload: { id: 'lead-rotated-token' } })
    assert.equal(newTokenEvent.statusCode, 200, newTokenEvent.body)
    assert.equal(newTokenEvent.json().accepted, true)

    const websiteConnectionResponse = await app.inject({
      method: 'POST',
      url: '/api/lead-sources/connections',
      headers: ownerHeaders,
      payload: { name: `官网询价 ${suffix}`, provider: 'website-form', autoCreateCustomer: true, createFollowUpTask: true },
    })
    assert.equal(websiteConnectionResponse.statusCode, 201, websiteConnectionResponse.body)
    const websiteConnection = websiteConnectionResponse.json()
    connectionIds.push(websiteConnection.id)
    assert.equal(websiteConnection.autoCreateCustomer, true)
    assert.equal(websiteConnection.createFollowUpTask, true)
    const websiteWebhookUrl = new URL(websiteConnection.webhookUrl)
    const websiteLead = await app.inject({ method: 'POST', url: websiteWebhookUrl.pathname + websiteWebhookUrl.search, payload: {
      id: `website-lead-${suffix}`,
      company: 'Acme Industrial Systems',
      full_name: 'Alex Morgan',
      email: 'alex@acme-industrial.example.com',
      phone: '+1 555 0100',
      job_title: 'Procurement Manager',
      region: 'United States',
      industry: 'Industrial equipment',
      message: 'Please send a quotation and delivery schedule.',
      website: 'https://acme-industrial.example',
      event_type: 'demo_request',
      utm_medium: 'paid-search',
      utm_campaign: 'enterprise-demo',
      landing_page: 'https://example.com/demo',
    } })
    assert.equal(websiteLead.statusCode, 200, websiteLead.body)
    assert.equal(websiteLead.json().status, 'processed')
    assert.ok(websiteLead.json().customerId)
    assert.ok(websiteLead.json().contactId)
    assert.ok(websiteLead.json().taskId)
    const storedCustomer = await db.$first(db.select().from(customers).where(eq(customers.id, websiteLead.json().customerId)))
    const storedContact = await db.$first(db.select().from(inboxContacts).where(eq(inboxContacts.id, websiteLead.json().contactId)))
    const storedTask = await db.$first(db.select().from(tasks).where(eq(tasks.id, websiteLead.json().taskId)))
    assert.equal(storedCustomer?.company, 'Acme Industrial Systems')
    assert.equal(storedCustomer?.stage, '待验证')
    assert.equal(storedContact?.email, 'alex@acme-industrial.example.com')
    assert.equal(storedTask?.priority, '高')
    assert.equal(storedTask?.status, 'open')
    const websiteTouchpoint = await db.$first(db.select().from(customerTouchpoints).where(eq(customerTouchpoints.externalId, `website-lead-${suffix}`)))
    assert.equal(websiteTouchpoint?.eventType, 'demo_request')
    assert.equal(websiteTouchpoint?.medium, 'paid-search')
    assert.equal(websiteTouchpoint?.campaign, 'enterprise-demo')

    const downloadLead = await app.inject({ method: 'POST', url: websiteWebhookUrl.pathname + websiteWebhookUrl.search, payload: {
      id: `website-download-${suffix}`, company: 'Download Interest Ltd', full_name: 'Casey Reader', email: 'casey@download-interest.example.com', event_type: 'content_download', content: 'B2B buying guide', landing_page: 'https://example.com/guides/b2b',
    } })
    assert.equal(downloadLead.statusCode, 200, downloadLead.body)
    const downloadTask = await db.$first(db.select().from(tasks).where(eq(tasks.id, downloadLead.json().taskId)))
    const downloadTouchpoint = await db.$first(db.select().from(customerTouchpoints).where(eq(customerTouchpoints.externalId, `website-download-${suffix}`)))
    assert.equal(downloadTask?.priority, '中')
    assert.equal(downloadTask?.dueLabel, '48 小时内')
    assert.equal(downloadTouchpoint?.eventType, 'content_download')

    const incompleteLead = await app.inject({ method: 'POST', url: websiteWebhookUrl.pathname + websiteWebhookUrl.search, payload: { id: `website-incomplete-${suffix}`, message: 'I need more information.' } })
    assert.equal(incompleteLead.statusCode, 200, incompleteLead.body)
    assert.equal(incompleteLead.json().status, 'needs_review')
    const eventsAfterWebsite = await app.inject({ method: 'GET', url: '/api/lead-sources/events', headers: ownerHeaders })
    const reviewEvent = eventsAfterWebsite.json().items.find((item: { providerEventId: string }) => item.providerEventId === `website-incomplete-${suffix}`)
    assert.ok(reviewEvent?.id)
    const manuallyProcessed = await app.inject({ method: 'POST', url: `/api/lead-sources/events/${reviewEvent.id}/process`, headers: ownerHeaders, payload: { company: 'Manual Review Company', full_name: 'Taylor Lee', email: 'taylor@manual-review.example.com', message: 'Qualified during manual review.' } })
    assert.equal(manuallyProcessed.statusCode, 200, manuallyProcessed.body)
    assert.equal(manuallyProcessed.json().status, 'processed')
    assert.ok(manuallyProcessed.json().customerId)

    // Google Ads official webhook key is sent as google_key in the payload; no query token is required.
    const googleResponse = await app.inject({ method: 'POST', url: '/api/lead-sources/connections', headers: ownerHeaders, payload: { name: `Google Lead Form ${suffix}`, provider: 'google-ads-lead-form', accountRef: 'campaign-100' } })
    assert.equal(googleResponse.statusCode, 201, googleResponse.body)
    connectionIds.push(googleResponse.json().id)
    const googleUrl = new URL(googleResponse.json().webhookUrl)
    const googleKey = googleResponse.json().webhookToken as string
    const badGoogle = await app.inject({ method: 'POST', url: googleUrl.pathname, payload: { google_key: 'wrong-key', lead_id: 'google-bad' } })
    assert.equal(badGoogle.statusCode, 403, badGoogle.body)
    const googleLead = await app.inject({ method: 'POST', url: googleUrl.pathname, payload: {
      google_key: googleKey, lead_id: `google-lead-${suffix}`, form_id: 'form-10', campaign_id: 'campaign-100',
      user_column_data: [
        { column_id: 'COMPANY_NAME', string_value: 'Google Lead Company' },
        { column_id: 'FULL_NAME', string_value: 'Jordan Buyer' },
        { column_id: 'EMAIL', string_value: 'jordan@google-lead.example.com' },
      ],
    } })
    assert.equal(googleLead.statusCode, 200, googleLead.body)
    assert.equal(googleLead.json().status, 'processed')

    // LinkedIn validates GET challenges and POST signatures with the app Client Secret.
    const linkedinSecret = 'linkedin-client-secret-value'
    const linkedinAccessToken = ['linkedin', 'access', 'token'].join('-')
    const linkedinResponse = await app.inject({ method: 'POST', url: '/api/lead-sources/connections', headers: ownerHeaders, payload: { name: `LinkedIn Lead Sync ${suffix}`, provider: 'linkedin-lead-gen', clientId: 'linkedin-client-id', accessToken: linkedinAccessToken, verificationSecret: linkedinSecret } })
    assert.equal(linkedinResponse.statusCode, 201, linkedinResponse.body)
    connectionIds.push(linkedinResponse.json().id)
    assert.equal(linkedinResponse.json().hasVerificationSecret, true)
    const linkedinUrl = new URL(linkedinResponse.json().webhookUrl)
    const challengeCode = '890e4665-4dfe-4ab1-b689-ed553bceeed0'
    const challengeResponse = await app.inject({ method: 'GET', url: `${linkedinUrl.pathname}${linkedinUrl.search}&challengeCode=${challengeCode}` })
    assert.equal(challengeResponse.statusCode, 200, challengeResponse.body)
    assert.equal(challengeResponse.json().challengeCode, challengeCode)
    assert.equal(challengeResponse.json().challengeResponse, createHmac('sha256', linkedinSecret).update(challengeCode).digest('hex'))
    const linkedinPayload = JSON.stringify({ type: 'LEAD_ACTION', leadGenFormResponse: 'urn:li:leadGenFormResponse:lead-100', leadGenForm: 'urn:li:versionedLeadGenForm:(urn:li:leadGenForm:10,1)', leadType: 'SPONSORED', leadAction: 'CREATED', occurredAt: 1720000000000 })
    const linkedinSignature = createHmac('sha256', linkedinSecret).update(`hmacsha256=${linkedinPayload}`).digest('hex')
    const badLinkedin = await app.inject({ method: 'POST', url: linkedinUrl.pathname + linkedinUrl.search, headers: { 'content-type': 'application/json', 'x-li-signature': 'bad-signature' }, payload: linkedinPayload })
    assert.equal(badLinkedin.statusCode, 403, badLinkedin.body)
    globalThis.fetch = (async (input, init) => {
      const requestedUrl = String(input)
      assert.ok(requestedUrl.includes('/rest/leadFormResponses/lead-100'))
      assert.ok(requestedUrl.includes('fields='))
      assert.equal(new Headers(init?.headers).get('authorization'), ['Bearer', linkedinAccessToken].join(' '))
      assert.equal(new Headers(init?.headers).get('linkedin-version'), '202606')
      return new Response(JSON.stringify({
        id: 'lead-100',
        leadType: 'SPONSORED',
        form: {
          content: { questions: [
            { questionId: 1, predefinedField: 'FIRST_NAME' },
            { questionId: 2, predefinedField: 'LAST_NAME' },
            { questionId: 3, predefinedField: 'COMPANY_NAME' },
            { questionId: 4, predefinedField: 'WORK_EMAIL' },
            { questionId: 5, predefinedField: 'JOB_TITLE' },
          ] },
          hiddenFields: [{ name: 'campaign_name', value: 'Enterprise Lead Gen' }],
        },
        formResponse: { answers: [
          { questionId: 1, answerDetails: { textQuestionAnswer: { answer: 'Morgan' } } },
          { questionId: 2, answerDetails: { textQuestionAnswer: { answer: 'Buyer' } } },
          { questionId: 3, answerDetails: { textQuestionAnswer: { answer: 'LinkedIn Verified Lead Ltd' } } },
          { questionId: 4, answerDetails: { textQuestionAnswer: { answer: 'morgan@linkedin-lead.example.com' } } },
          { questionId: 5, answerDetails: { textQuestionAnswer: { answer: 'Procurement Director' } } },
        ] },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const linkedinNotification = await app.inject({ method: 'POST', url: linkedinUrl.pathname + linkedinUrl.search, headers: { 'content-type': 'application/json', 'x-li-signature': linkedinSignature }, payload: linkedinPayload })
    assert.equal(linkedinNotification.statusCode, 200, linkedinNotification.body)
    assert.equal(linkedinNotification.json().status, 'processed')
    const linkedinCustomer = await db.$first(db.select().from(customers).where(eq(customers.id, linkedinNotification.json().customerId)))
    const linkedinContact = await db.$first(db.select().from(inboxContacts).where(eq(inboxContacts.id, linkedinNotification.json().contactId)))
    assert.equal(linkedinCustomer?.company, 'LinkedIn Verified Lead Ltd')
    assert.equal(linkedinContact?.name, 'Morgan Buyer')
    assert.equal(linkedinContact?.email, 'morgan@linkedin-lead.example.com')
    assert.equal(linkedinContact?.jobTitle, 'Procurement Director')
    globalThis.fetch = originalFetch

    // Meta Lead Ads uses the exact raw body and X-Hub-Signature-256.
    const metaSecret = 'meta-app-secret-value'
    const signedMetaResponse = await app.inject({ method: 'POST', url: '/api/lead-sources/connections', headers: ownerHeaders, payload: { name: `Meta Signed ${suffix}`, provider: 'meta-lead-ads', accessToken: 'meta-access-token', verificationSecret: metaSecret } })
    assert.equal(signedMetaResponse.statusCode, 201, signedMetaResponse.body)
    connectionIds.push(signedMetaResponse.json().id)
    const signedMetaUrl = new URL(signedMetaResponse.json().webhookUrl)
    const metaPayload = JSON.stringify({ leadgen_id: `meta-signed-${suffix}`, form_id: 'meta-form-1' })
    const metaSignature = `sha256=${createHmac('sha256', metaSecret).update(metaPayload).digest('hex')}`
    const badSignedMeta = await app.inject({ method: 'POST', url: signedMetaUrl.pathname + signedMetaUrl.search, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, payload: metaPayload })
    assert.equal(badSignedMeta.statusCode, 403, badSignedMeta.body)
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'mock permission pending' } }), { status: 403, headers: { 'content-type': 'application/json' } })) as typeof fetch
    const signedMeta = await app.inject({ method: 'POST', url: signedMetaUrl.pathname + signedMetaUrl.search, headers: { 'content-type': 'application/json', 'x-hub-signature-256': metaSignature }, payload: metaPayload })
    assert.equal(signedMeta.statusCode, 200, signedMeta.body)
    assert.equal(signedMeta.json().status, 'needs_review')

    console.log('Lead sources integration passed: connection permissions, secret redaction, Google key validation, LinkedIn signed notification and response mapping, Meta raw-body signature, idempotency, automatic customer/contact/task creation, review fallback and token rotation verified.')
  } finally {
    globalThis.fetch = originalFetch
    for (const id of connectionIds) await db.delete(leadSourceEvents).where(eq(leadSourceEvents.connectionId, id))
    for (const id of connectionIds) await db.delete(leadSourceConnections).where(eq(leadSourceConnections.id, id))
    if (memberId) await db.delete(users).where(eq(users.id, memberId))
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
