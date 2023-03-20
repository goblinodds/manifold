import { PencilAltIcon, SwitchHorizontalIcon } from '@heroicons/react/solid'
import clsx from 'clsx'

import { Contract, CPMMContract } from 'common/contract'
import { BACKGROUND_COLOR } from 'common/envs/constants'
import { GlobalConfig } from 'common/globalConfig'
import { Group } from 'common/group'
import { Post } from 'common/post'
import Router from 'next/router'
import { memo, ReactNode } from 'react'
import { ActivityLog } from 'web/components/activity-log'
import { DailyStats } from 'web/components/daily-stats'
import { PinnedItems } from 'web/components/groups/group-post-section'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { Row } from 'web/components/layout/row'
import { LoadingIndicator } from 'web/components/widgets/loading-indicator'
import { SiteLink } from 'web/components/widgets/site-link'
import { useTrendingGroups } from 'web/hooks/use-group'
import {
  inMemoryStore,
  storageStore,
  usePersistentState,
} from 'web/hooks/use-persistent-state'
import { useAllPosts } from 'web/hooks/use-post'
import { useRedirectIfSignedOut } from 'web/hooks/use-redirect-if-signed-out'
import { useSaveReferral } from 'web/hooks/use-save-referral'
import { useTracking } from 'web/hooks/use-tracking'
import { useUser } from 'web/hooks/use-user'
import { getContractFromId } from 'web/lib/firebase/contracts'
import { updateGlobalConfig } from 'web/lib/firebase/globalConfig'
import { getGroup } from 'web/lib/firebase/groups'
import { getPost } from 'web/lib/firebase/posts'
import GoToIcon from 'web/lib/icons/go-to-icon'
import { track } from 'web/lib/service/analytics'
import { Title } from 'web/components/widgets/title'
import { MobileSearchButton } from 'web/components/nav/search-button'
import { useIsMobile } from 'web/hooks/use-is-mobile'
import { useIsClient } from 'web/hooks/use-is-client'
import { ContractsFeed } from '../../components/contract/contracts-feed'
import { Swipe } from 'web/components/swipe/swipe'
import { getIsNative } from 'web/lib/native/is-native'
import { useYourDailyChangedContracts } from 'web/hooks/use-your-daily-changed-contracts'
import { db } from '../../lib/supabase/db'
import { ProbChangeTable } from 'web/components/contract/prob-change-table'
import { safeLocalStorage } from 'web/lib/util/local'
import { ContractCardNew } from 'web/components/contract/contract-card'
import { ChoicesToggleGroup } from 'web/components/widgets/choices-toggle-group'

export default function Home() {
  const isClient = useIsClient()
  const isMobile = useIsMobile()
  useTracking('view home', { kind: isMobile ? 'swipe' : 'desktop' })
  useRedirectIfSignedOut()

  if (!isClient)
    return (
      <Page>
        <LoadingIndicator className="mt-6" />
      </Page>
    )

  if (isMobile) {
    return <MobileHome />
  }
  return <HomeDashboard />
}

function HomeDashboard() {
  const user = useUser()
  useSaveReferral()

  const dailyChangedContracts = useYourDailyChangedContracts(db, user?.id)

  const isLoading = !dailyChangedContracts

  return (
    <Page>
      <Col className="mx-auto w-full max-w-2xl gap-6 pb-8 sm:px-2 lg:pr-4">
        <Row className={'w-full items-center justify-between gap-4'}>
          <Title children="Home" className="!my-0 hidden sm:block" />
          <MobileSearchButton className="flex-1 md:hidden" />
          <DailyStats user={user} />
        </Row>

        {isLoading && <LoadingIndicator />}

        <Col className={clsx('gap-6', isLoading && 'hidden')}>
          <YourDailyUpdates contracts={dailyChangedContracts} />
          <MainContent />
        </Col>
      </Col>
    </Page>
  )
}

function MobileHome() {
  const user = useUser()
  const { showSwipe, toggleView, isNative } = useViewToggle()

  const dailyChangedContracts = useYourDailyChangedContracts(db, user?.id)

  const isLoading = !dailyChangedContracts

  if (showSwipe) return <Swipe toggleView={toggleView(false)} />

  return (
    <Page>
      <Col className="gap-6 py-2 pb-8 sm:px-2">
        <Row className="mx-4 mb-2 items-center justify-between gap-4">
          <Title children="Home" className="!my-0" />

          <Row className="items-center gap-4">
            <DailyStats user={user} />
            {isNative && (
              <SwitchHorizontalIcon
                className="h-5 w-5"
                onClick={toggleView(true)}
              />
            )}
          </Row>
        </Row>

        {isLoading && <LoadingIndicator />}
        <Col className={clsx('gap-6', isLoading && 'hidden')}>
          <YourDailyUpdates contracts={dailyChangedContracts} />
          <MainContent />
        </Col>
      </Col>

      <button
        type="button"
        className={clsx(
          'focus:ring-primary-500 fixed bottom-[70px] right-3 z-20 inline-flex items-center rounded-full border  border-transparent  p-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 lg:hidden',
          'disabled:bg-ink-300 text-ink-0 from-primary-500 hover:from-primary-700 to-blue-500 hover:to-blue-700 enabled:bg-gradient-to-r'
        )}
        onClick={() => {
          Router.push('/create')
          track('mobile create button')
        }}
      >
        <PencilAltIcon className="h-6 w-6" aria-hidden="true" />
      </button>
    </Page>
  )
}

const useViewToggle = () => {
  const isNative = getIsNative()

  const defaultShowSwipe =
    typeof window === 'undefined'
      ? false
      : safeLocalStorage?.getItem('show-swipe')
      ? safeLocalStorage?.getItem('show-swipe') === 'true'
      : isNative

  const [showSwipe, setShowSwipe] = usePersistentState(defaultShowSwipe, {
    key: 'show-swipe',
    store: storageStore(safeLocalStorage),
  })

  const toggleView = (showSwipe: boolean) => () => {
    setShowSwipe(showSwipe)
    track('toggle swipe', { showSwipe })
  }
  return { showSwipe, toggleView, isNative }
}

function HomeSectionHeader(props: {
  label: string
  href?: string
  children?: ReactNode
  icon?: string
}) {
  const { label, href, children, icon } = props

  return (
    <Row
      className={clsx(
        'text-ink-900 sticky top-0 z-20 items-center justify-between px-1 pb-3 sm:px-0',
        BACKGROUND_COLOR
      )}
    >
      {icon != null && <div className="mr-2 inline">{icon}</div>}
      {href ? (
        <SiteLink
          className="flex-1 text-lg md:text-xl"
          href={href}
          onClick={() => track('home click section header', { section: href })}
        >
          {label}
          <GoToIcon className="text-ink-400 mb-1 ml-2 inline h-5 w-5" />
        </SiteLink>
      ) : (
        <div className="flex-1 text-lg md:text-xl">{label}</div>
      )}
      {children}
    </Row>
  )
}

const YourDailyUpdates = memo(function YourDailyUpdates(props: {
  contracts: CPMMContract[] | undefined
}) {
  const { contracts } = props
  const changedContracts = contracts
    ? contracts.filter((c) => Math.abs(c.probChanges?.day ?? 0) >= 0.01)
    : undefined
  if (!changedContracts || changedContracts.length === 0) return <></>

  return (
    <Col>
      <HomeSectionHeader label="Today's updates" icon="📊" />
      <ProbChangeTable changes={changedContracts as CPMMContract[]} />
    </Col>
  )
})

const LiveSection = memo(function LiveSection() {
  return (
    <Col className="relative">
      {/* <HomeSectionHeader label="Live feed" href="/live" icon="🔴" /> */}
      <ActivityLog
        count={30}
        showPills={false}
        // className="h-[380px] overflow-hidden"
      />
      <div className="from-canvas-50 pointer-events-none absolute bottom-0 h-5 w-full select-none bg-gradient-to-t to-transparent" />
    </Col>
  )
})

const YourFeedSection = memo(function YourFeedSection() {
  return (
    <Col>
      {/* <HomeSectionHeader label={'Your feed'} icon={'📖'} /> */}
      <ContractsFeed />
    </Col>
  )
})

const MainContent = () => {
  const sections = [<YourFeedSection />, <LiveSection />]

  const [section, setSection] = usePersistentState<number>(0, {
    key: 'main-content-section',
    store: inMemoryStore(),
  })

  return (
    <Col>
      <ChoicesToggleGroup
        className="rounded-b-none rounded-t-sm border-[0.5px] border-b-0"
        choicesMap={{
          'For you': 0,
          'Live feed': 1,
        }}
        currentChoice={section}
        setChoice={setSection as any}
        color="indigo"
      />

      {sections[section]}
    </Col>
  )
}

export const ContractsSection = memo(function ContractsSection(props: {
  contracts: Contract[]
  label: string
  icon: string
  className?: string
}) {
  const { contracts, className } = props
  return (
    <Col className={className}>
      {/* <HomeSectionHeader label={label} icon={icon} /> */}
      <Col className="divide-ink-300 border-ink-300 max-w-2xl divide-y rounded border">
        {contracts.map((contract) => (
          <ContractCardNew key={contract.id} contract={contract} />
        ))}
      </Col>
    </Col>
  )
})

export function FeaturedSection(props: {
  globalConfig: GlobalConfig
  pinned: JSX.Element[]
  isAdmin: boolean
}) {
  const { globalConfig, pinned, isAdmin } = props
  const posts = useAllPosts()
  const groups = useTrendingGroups()

  async function onSubmit(selectedItems: { itemId: string; type: string }[]) {
    if (globalConfig == null) return
    const pinnedItems = await Promise.all(
      selectedItems
        .map(async (item) => {
          if (item.type === 'post') {
            const post = await getPost(item.itemId)
            if (post == null) return null

            return { item: post, type: 'post' }
          } else if (item.type === 'contract') {
            const contract = await getContractFromId(item.itemId)
            if (contract == null) return null

            return { item: contract, type: 'contract' }
          } else if (item.type === 'group') {
            const group = await getGroup(item.itemId)
            if (group == null) return null
            return { item: group, type: 'group' }
          }
        })
        .filter((item) => item != null)
    )
    await updateGlobalConfig(globalConfig, {
      pinnedItems: [
        ...(globalConfig?.pinnedItems ?? []),
        ...(pinnedItems as {
          item: Contract | Post | Group
          type: 'contract' | 'post' | 'group'
        }[]),
      ],
    })
  }

  function onDeleteClicked(index: number) {
    if (globalConfig == null) return
    const newPinned = globalConfig.pinnedItems.filter((item) => {
      return item.item.id !== globalConfig.pinnedItems[index].item.id
    })
    updateGlobalConfig(globalConfig, { pinnedItems: newPinned })
  }

  return (
    <Col className="relative">
      <HomeSectionHeader label={'Featured'} icon={'📌'} />
      <PinnedItems
        posts={posts}
        isEditable={isAdmin}
        pinned={pinned}
        onDeleteClicked={onDeleteClicked}
        onSubmit={onSubmit}
        modalMessage={'Pin posts or markets to the overview of this group.'}
        groups={groups}
      />
    </Col>
  )
}
