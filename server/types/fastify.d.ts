import 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    auth: {
      sessionId: string
      userId: string
      email: string
      displayName: string
      workspaceId: string
      workspaceName: string
      role: string
    }
  }
}
