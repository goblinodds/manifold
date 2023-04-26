import {
  SupabaseClient,
  TableName,
  RowFor,
  ViewName,
  DataFor,
} from 'common/supabase/utils'
import { useEffect, useId, useRef, useState } from 'react'
import { uniqBy } from 'lodash'
import { filterDefined } from 'common/util/array'
import { RealtimeChannel } from '@supabase/realtime-js'

function hasFsUpdatedTime(obj: any): obj is { fs_updated_time: number } {
  return 'fs_updated_time' in obj
}

let mainChannel: undefined | RealtimeChannel = undefined
let subscriptionStatus:
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR'
  | 'CONNECTING' = 'CONNECTING'
const callbacks: {
  hookId: string
  callback: (data: any) => void
  filter: string
  table: string
}[] = []
let mainChannelResubscribeInterval: NodeJS.Timer | undefined = undefined

export function useValuesFromSupabase<
  T extends TableName | ViewName,
  K extends keyof RowFor<T>
>(
  table: T,
  rowGroupKey: K,
  rowGroupValue: string,
  uniqueRowDataKey: K,
  db: SupabaseClient,
  getInitialValues?: (uniqueRowGroupValue: string) => Promise<RowFor<T>[]>
) {
  const [values, setValues] = useState<RowFor<T>[]>([])
  const hookId = useId()
  const channelName = 'supabase-realtime-values'
  const filter = `${rowGroupKey as string}=eq.${rowGroupValue}`
  const valuesToDelete = useRef<RowFor<T>[]>([])
  const retrievedInitialValues = useRef<boolean>(false)
  const channelResubscribeInterval = useRef<NodeJS.Timer>()
  // TODO:
  // 1. turn off out resubscription interval, toggle wifi to see if it handles its own stuff
  // 2. if we disconnect, set the initial values state to false to reget it.
  // 3. pass a callback to accept how we should handle updates - actually make this specific to the contrac metrics unless it also applies to contract-bets
  // 4. email supabase for why we only have 500 concurrent channels/topics
  // 5. address PR comments
  // 6. does this actually work for views?

  const getMyCallback = () => {
    return {
      hookId,
      callback: updateValuesOnPostgresEvent,
      filter,
      table,
    }
  }

  useEffect(() => {
    initChannelAndCallbacks()
  }, [db])

  const initChannelAndCallbacks = () => {
    // very first channel opened
    if (!mainChannel) subscribeToNewChannel()
    // channel already exists, restart and resubscribe callbacks, adding my own
    else restartChannel()
  }

  const restartChannel = async () => {
    console.log('Restarting channel')
    subscriptionStatus = 'CONNECTING'
    if (mainChannel) {
      await mainChannel.unsubscribe()
      await db.removeChannel(mainChannel)
      mainChannel = undefined
    }
    initChannelAndCallbacks()
  }

  // Must be called only once per channel
  const subscribeToNewChannel = () => {
    const channel = db.channel(channelName)
    callbacks.push(getMyCallback())
    setChannelCallbacks(channel)
    channel.subscribe(async (status, err) => {
      console.log('channel subscribe status', status, err)
      if (
        status !== 'SUBSCRIBED' &&
        subscriptionStatus !== 'CONNECTING' &&
        !mainChannelResubscribeInterval
      ) {
        startResubscribeLoop()
      }
      subscriptionStatus = status
    })
    mainChannel = channel
  }

  const updateValuesOnPostgresEvent = (payload: any) => {
    setValues((prev) => {
      const { new: newRecord, old: oldRecord } = payload
      // if this is a DELETE operation, the oldValue will only have the primary key values set
      const oldValue = oldRecord as RowFor<T>
      const index = prev.findIndex(
        (m) => m[uniqueRowDataKey] === oldValue[uniqueRowDataKey]
      )
      // New row with filled values
      if (newRecord && newRecord[uniqueRowDataKey]) {
        const newValue = newRecord as RowFor<T>
        // We already have this row, so update it
        if (oldRecord && index > -1) {
          prev[index] = newValue
          return prev
        }
        // We don't have this row, or there wasn't an old record in supabase, so add it
        else return uniqBy([...prev, newValue], uniqueRowDataKey)

        // Empty new record, delete it or save it for deletion
      } else {
        if (index > -1) {
          prev.splice(index, 1)
          return prev
        }
        // Delete the value once we get the values
        valuesToDelete.current = [...valuesToDelete.current, oldValue]
        return prev
      }
    })
  }

  const loadDefaultAllInitialValuesForRowGroup = async () => {
    const { data } = await db
      .from(table)
      .select('*')
      .eq(rowGroupKey as string, rowGroupValue)
    if (data) {
      setValues(data)
    }
  }

  useEffect(() => {
    if (retrievedInitialValues.current || subscriptionStatus !== 'SUBSCRIBED')
      return
    retrievedInitialValues.current = true
    // Retrieve initial values
    if (getInitialValues)
      getInitialValues(rowGroupValue).then((newValues) =>
        setValues((prev) => {
          return filterDefined(
            newValues.map((newVal) => {
              const index = prev.findIndex(
                (p) => p[uniqueRowDataKey] == newVal[uniqueRowDataKey]
              )
              // previous value exists in subscription
              if (index > -1) {
                const prevVal = prev[index]
                if (hasFsUpdatedTime(prevVal) && hasFsUpdatedTime(newVal)) {
                  return prevVal.fs_updated_time > newVal.fs_updated_time
                    ? prevVal
                    : newVal
                } else return newVal
              }
              if (
                valuesToDelete.current.find(
                  (v) => v[uniqueRowDataKey] == newVal[uniqueRowDataKey]
                )
              )
                return null
              return newVal
            })
          )
        })
      )
    else loadDefaultAllInitialValuesForRowGroup()
    valuesToDelete.current = []
  }, [getInitialValues, subscriptionStatus])

  // Just a helper for now, delete later
  useEffect(() => {
    console.log('Values updated:', values.length)
  }, [values])

  const startResubscribeLoop = () => {
    if (mainChannelResubscribeInterval) {
      console.log(
        'Clearing existing resubscribe interval',
        mainChannelResubscribeInterval
      )
      clearInterval(mainChannelResubscribeInterval)
    }
    const interval = setInterval(async () => {
      if (mainChannelResubscribeInterval !== interval) return
      console.log('Running resubscribe interval', interval)
      console.log(
        'Resubscribe interval subscription status',
        subscriptionStatus
      )
      if (subscriptionStatus !== 'SUBSCRIBED') {
        await restartChannel()
      } else {
        console.log(
          'Clearing resubscribe interval, channel status subscribed',
          interval
        )
        clearInterval(interval)
        mainChannelResubscribeInterval = undefined
      }
    }, 3000)
    channelResubscribeInterval.current = interval
    mainChannelResubscribeInterval = interval
  }

  const setChannelCallbacks = (channel: RealtimeChannel) => {
    // get all callbacks unique by table and filter
    const uniqueCallbacks = uniqBy(callbacks, (c) => `${c.table}-${c.filter}`)
    uniqueCallbacks.map((c) => {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: c.table,
          filter: c.filter,
        },
        (payload: any) => {
          console.log('postgres_changes', payload)
          // get all callbacks for this table and filter
          const relevantCallbacks = callbacks.filter(
            (cb) => cb.table === c.table && cb.filter === c.filter
          )
          relevantCallbacks.forEach((cb) => cb.callback(payload))
        }
      )
    })
  }

  useEffect(() => {
    return () => {
      if (channelResubscribeInterval.current) {
        console.log('Clearing resubscribe interval in use effect return')
        clearInterval(channelResubscribeInterval.current)
        if (
          mainChannelResubscribeInterval === channelResubscribeInterval.current
        ) {
          mainChannelResubscribeInterval = undefined
        }
      }
      const myIndex = callbacks.findIndex((c) => c.hookId === hookId)
      if (myIndex > -1) callbacks.splice(myIndex, 1)
    }
  }, [callbacks])
  return values.map((m) => ('data' in m ? (m.data as DataFor<T>) : m))
}
