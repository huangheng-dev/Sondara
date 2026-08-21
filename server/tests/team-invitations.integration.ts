import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { users, workspaceInvitations, workspaceMembers } from '../db/schema.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const invitationToken = (inviteUrl: string) => new URL(inviteUrl, 'http://127.0.0.1:4175').searchParams.get('invite') ?? ''

const run = async () => {
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const ownerEmail = `invite-owner-${suffix}@sondara.local`
  let ownerId = ''
  const invitedUserIds: string[] = []
  try {
    const owner = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: '邀请所有者', email: ownerEmail, password: 'InviteOwner@2026' },
    })
    assert.equal(owner.statusCode, 201, owner.body)
    ownerId = owner.json().user.id
    const ownerHeaders = { cookie: cookieValue(owner.headers['set-cookie']) }

    const member = await app.inject({
      method: 'POST',
      url: '/api/admin/members',
      headers: ownerHeaders,
      payload: { displayName: '普通成员', email: `invite-member-${suffix}@sondara.local`, password: 'InviteMember@2026', role: 'member' },
    })
    assert.equal(member.statusCode, 201, member.body)
    const memberLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `invite-member-${suffix}@sondara.local`, password: 'InviteMember@2026', remember: true } })
    assert.equal(memberLogin.statusCode, 200, memberLogin.body)
    const memberHeaders = { cookie: cookieValue(memberLogin.headers['set-cookie']) }

    const memberCannotInvite = await app.inject({ method: 'GET', url: '/api/admin/invitations', headers: memberHeaders })
    assert.equal(memberCannotInvite.statusCode, 403, memberCannotInvite.body)

    const invalidAccept = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', payload: { token: `not-a-valid-token-${suffix}`, password: 'InvitedUser@2026' } })
    assert.equal(invalidAccept.statusCode, 410, invalidAccept.body)

    const inviteEmail = `invited-user-${suffix}@sondara.local`
    const invite = await app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      headers: ownerHeaders,
      payload: { displayName: '被邀请用户', email: inviteEmail, role: 'viewer' },
    })
    assert.equal(invite.statusCode, 201, invite.body)
    assert.equal(invite.json().role, 'viewer')
    const inviteId = invite.json().id
    const token = invitationToken(invite.json().inviteUrl)
    assert.ok(token.length >= 20)

    const duplicateInvite = await app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      headers: ownerHeaders,
      payload: { displayName: '重复邀请', email: inviteEmail, role: 'viewer' },
    })
    assert.equal(duplicateInvite.statusCode, 409, duplicateInvite.body)

    const invitations = await app.inject({ method: 'GET', url: '/api/admin/invitations', headers: ownerHeaders })
    assert.equal(invitations.statusCode, 200, invitations.body)
    assert.ok(invitations.json().items.some((item: { id: string; email: string }) => item.id === inviteId && item.email === inviteEmail))

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/auth/accept-invite',
      payload: { token, password: 'InvitedUser@2026', displayName: '已接受邀请用户' },
    })
    assert.equal(accepted.statusCode, 201, accepted.body)
    assert.equal(accepted.json().workspace.role, 'viewer')
    invitedUserIds.push(accepted.json().user.id)

    const membership = (await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, accepted.json().user.id)))[0]
    assert.equal(membership.role, 'viewer')
    const acceptedInvite = (await db.select().from(workspaceInvitations).where(eq(workspaceInvitations.id, inviteId)))[0]
    assert.ok(acceptedInvite.acceptedAt)

    const acceptedAgain = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', payload: { token, password: 'InvitedUser@2026' } })
    assert.equal(acceptedAgain.statusCode, 410, acceptedAgain.body)

    const revokeEmail = `revoked-user-${suffix}@sondara.local`
    const revokeInvite = await app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      headers: ownerHeaders,
      payload: { displayName: '待撤销用户', email: revokeEmail, role: 'member' },
    })
    assert.equal(revokeInvite.statusCode, 201, revokeInvite.body)
    const revokedToken = invitationToken(revokeInvite.json().inviteUrl)
    const revoked = await app.inject({ method: 'POST', url: `/api/admin/invitations/${revokeInvite.json().id}/revoke`, headers: ownerHeaders })
    assert.equal(revoked.statusCode, 200, revoked.body)
    const useRevoked = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', payload: { token: revokedToken, password: 'RevokedUser@2026' } })
    assert.equal(useRevoked.statusCode, 410, useRevoked.body)

    console.log('Team invitations integration passed: create, duplicate prevention, accept, membership role, one-time use and revocation verified.')
  } finally {
    for (const id of invitedUserIds) await db.delete(users).where(eq(users.id, id))
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
