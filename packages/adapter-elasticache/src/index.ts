import type {
  Adapter,
  AdapterUser,
  AdapterAccount,
  AdapterSession,
} from "@auth/core/adapters"
import crypto from "crypto";

/** This is the interface of the Redis adapter options. */
export interface RedisAdapterOptions {
  /**
   * The base prefix for your keys
   */
  baseKeyPrefix?: string
  /**
   * The prefix for the `account` key
   */
  accountKeyPrefix?: string
  /**
   * The prefix for the `accountByUserId` key
   */
  accountByUserIdPrefix?: string
  /**
   * The prefix for the `emailKey` key
   */
  emailKeyPrefix?: string
  /**
   * The prefix for the `sessionKey` key
   */
  sessionKeyPrefix?: string
  /**
   * The prefix for the `sessionByUserId` key
   */
  sessionByUserIdKeyPrefix?: string
  /**
   * The prefix for the `user` key
   */
  userKeyPrefix?: string
  /**
   * The prefix for the `verificationToken` key
   */
  verificationTokenKeyPrefix?: string
  /**
   * TTL for session (in seconds)
   */
  sessionKeyTTLSeconds?: number
}

export const defaultOptions = {
  baseKeyPrefix: "",
  accountKeyPrefix: "user:account:",
  accountByUserIdPrefix: "user:account:by-user-id:",
  emailKeyPrefix: "user:email:",
  sessionKeyPrefix: "user:session:",
  sessionByUserIdKeyPrefix: "user:session:by-user-id:",
  userKeyPrefix: "user:",
  verificationTokenKeyPrefix: "user:token:",
}

const isoDateRE =
  /(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/
function isDate(value: any) {
  return value && isoDateRE.test(value) && !isNaN(Date.parse(value))
}

export function hydrateDates(json: object) {
  return Object.entries(json).reduce((acc, [key, val]) => {
    acc[key] = isDate(val) ? new Date(val as string) : val
    return acc
  }, {} as any)
}

export function ElasticacheAdapter(
  client: any,
  options: RedisAdapterOptions = {}
): Adapter {
  const mergedOptions = {
    ...defaultOptions,
    ...options,
  }

  const { baseKeyPrefix } = mergedOptions
  const accountKeyPrefix = baseKeyPrefix + mergedOptions.accountKeyPrefix
  const accountByUserIdPrefix =
    baseKeyPrefix + mergedOptions.accountByUserIdPrefix
  const emailKeyPrefix = baseKeyPrefix + mergedOptions.emailKeyPrefix
  const sessionKeyPrefix = baseKeyPrefix + mergedOptions.sessionKeyPrefix
  const sessionByUserIdKeyPrefix =
    baseKeyPrefix + mergedOptions.sessionByUserIdKeyPrefix
  const userKeyPrefix = baseKeyPrefix + mergedOptions.userKeyPrefix
  const verificationTokenKeyPrefix =
    baseKeyPrefix + mergedOptions.verificationTokenKeyPrefix

  const setObjectAsJson = async (key: string, obj: any) => {
    if(mergedOptions.sessionKeyTTLSeconds) {
      await client.set(key, JSON.stringify(obj), { 'EX': mergedOptions.sessionKeyTTLSeconds } )
    } else {
      await client.set(key, JSON.stringify(obj))
    }
  }

  const setAccount = async (id: string, account: AdapterAccount) => {
    const accountKey = accountKeyPrefix + id
    await setObjectAsJson(accountKey, account)
    if(mergedOptions.sessionKeyTTLSeconds) {
      await client.set(accountByUserIdPrefix + account.userId, accountKey, { 'EX': mergedOptions.sessionKeyTTLSeconds } )
    } else {
      await client.set(accountByUserIdPrefix + account.userId, accountKey)
    }
    return account
  }

  const getAccount = async (id: string) => {
    const account = await client.get(accountKeyPrefix + id)
    if (!account) return null
    if(mergedOptions.sessionKeyTTLSeconds) {
      client.expire(accountKeyPrefix + id, mergedOptions.sessionKeyTTLSeconds)
    }
    return hydrateDates(JSON.parse(account))
  }

  const setSession = async (
    id: string,
    session: AdapterSession
  ): Promise<AdapterSession> => {
    const sessionKey = sessionKeyPrefix + id
    await setObjectAsJson(sessionKey, session)
    if(mergedOptions.sessionKeyTTLSeconds) {
      await client.set(sessionByUserIdKeyPrefix + session.userId, sessionKey, { 'EX': mergedOptions.sessionKeyTTLSeconds } )
    } else {
      await client.set(sessionByUserIdKeyPrefix + session.userId, sessionKey)
    }
    return session
  }

  const getSession = async (id: string) => {
    const session = await client.get(sessionKeyPrefix + id)
    if (!session) return null
    if(mergedOptions.sessionKeyTTLSeconds) {
      client.expire(sessionKeyPrefix + id, mergedOptions.sessionKeyTTLSeconds)
    }
    return hydrateDates(JSON.parse(session))
  }

  const setUser = async (
    id: string,
    user: AdapterUser
  ): Promise<AdapterUser> => {
    await setObjectAsJson(userKeyPrefix + id, user)
    if(user.email) {
      if(mergedOptions.sessionKeyTTLSeconds) {
        await client.set(`${emailKeyPrefix}${user.email as string}`, id, { 'EX': mergedOptions.sessionKeyTTLSeconds } )
      } else {
        await client.set(`${emailKeyPrefix}${user.email as string}`, id)
      }
    }
    return user
  }

  const getUser = async (id: string) => {
    const user = await client.get(userKeyPrefix + id)
    if (!user) return null
    if(mergedOptions.sessionKeyTTLSeconds) {
      client.expire(userKeyPrefix + id, mergedOptions.sessionKeyTTLSeconds)
    }
    return hydrateDates(JSON.parse(user))
  }

  return {
    async createUser(user) {
      const id = crypto.randomUUID()
      // TypeScript thinks the emailVerified field is missing
      // but all fields are copied directly from user, so it's there
      return await setUser(id, { ...user, id })
    },
    getUser,
    async getUserByEmail(email) {
      const userId = await client.get(emailKeyPrefix + email)
      if (!userId) return null
      if(mergedOptions.sessionKeyTTLSeconds) {
        client.expire(emailKeyPrefix + email, mergedOptions.sessionKeyTTLSeconds)
      }
      return await getUser(userId)
    },
    async getUserByAccount(account) {
      const dbAccount = await getAccount(
        `${account.provider}:${account.providerAccountId}`
      )
      if (!dbAccount) return null
      return await getUser(dbAccount.userId)
    },
    async updateUser(updates) {
      const userId = updates.id as string
      const user = await getUser(userId)
      return await setUser(userId, { ...(user as AdapterUser), ...updates })
    },
    async linkAccount(account) {
      const id = `${account.provider}:${account.providerAccountId}`
      return await setAccount(id, { ...account, id })
    },
    createSession: (session) => setSession(session.sessionToken, session),
    async getSessionAndUser(sessionToken) {
      const session = await getSession(sessionToken)
      if (!session) return null
      const user = await getUser(session.userId)
      if (!user) return null
      return { session, user }
    },
    async updateSession(updates) {
      const session = await getSession(updates.sessionToken)
      if (!session) return null
      return await setSession(updates.sessionToken, { ...session, ...updates })
    },
    async deleteSession(sessionToken) {
      const session = await getSession(sessionToken);
      await client.del(sessionKeyPrefix + sessionToken)
      return session;
    },
    async createVerificationToken(verificationToken) {
      await setObjectAsJson(
        verificationTokenKeyPrefix +
          verificationToken.identifier +
          ":" +
          verificationToken.token,
        verificationToken
      )
      return verificationToken
    },
    async useVerificationToken(verificationToken) {
      const tokenKey =
        verificationTokenKeyPrefix +
        verificationToken.identifier +
        ":" +
        verificationToken.token

      const token = await client.get(tokenKey)
      if (!token) return null

      await client.del(tokenKey)
      return hydrateDates(JSON.parse(token))
      // return reviveFromJson(token)
    },
    async unlinkAccount(account) {
      const id = `${account.provider}:${account.providerAccountId}`
      const dbAccount = await getAccount(id)
      if (!dbAccount) return
      const accountKey = `${accountKeyPrefix}${id}`
      await client.del(
        accountKey,
        `${accountByUserIdPrefix} + ${dbAccount.userId as string}`
      )
    },
    async deleteUser(userId) {
      const user = await getUser(userId)
      if (!user) return
      const accountByUserKey = accountByUserIdPrefix + userId
      const accountKey = await client.get(accountByUserKey)
      const sessionByUserIdKey = sessionByUserIdKeyPrefix + userId
      const sessionKey = await client.get(sessionByUserIdKey)
      await client.del(
        userKeyPrefix + userId,
        `${emailKeyPrefix}${user.email as string}`,
        accountKey as string,
        accountByUserKey,
        sessionKey as string,
        sessionByUserIdKey
      )
    },
  }
}
