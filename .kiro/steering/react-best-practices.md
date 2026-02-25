---
inclusion: fileMatch
fileMatchPattern: "apps/admin/src/**/*.{tsx,ts}"
---

# React Best Practices (Vercel)

> Source: vercel-labs/agent-skills/react-best-practices
> 适用于 Admin 后台 (React 19 + Vite SPA)
> 已过滤掉 Next.js SSR/RSC 专属规则，保留 Vite SPA 适用的部分

## 1. Eliminating Waterfalls (CRITICAL)

### Defer Await Until Needed
Move `await` into branches where actually used. Don't block unused code paths.

```typescript
// ❌ blocks both branches
async function handleRequest(userId: string, skip: boolean) {
  const userData = await fetchUserData(userId)
  if (skip) return { skipped: true }
  return processUserData(userData)
}

// ✅ only blocks when needed
async function handleRequest(userId: string, skip: boolean) {
  if (skip) return { skipped: true }
  const userData = await fetchUserData(userId)
  return processUserData(userData)
}
```

### Promise.all() for Independent Operations

```typescript
// ❌ sequential
const user = await fetchUser()
const config = await fetchConfig()

// ✅ parallel
const [user, config] = await Promise.all([fetchUser(), fetchConfig()])
```

### Strategic Suspense Boundaries
Wrap independent sections in separate `<Suspense>` boundaries so they stream independently.

## 2. Bundle Size Optimization (CRITICAL)

### Avoid Barrel File Imports

```typescript
// ❌ imports entire barrel
import { Button } from '@/components'

// ✅ direct import
import { Button } from '@/components/ui/button'
```

### Dynamic Imports for Heavy Components

```typescript
// ❌ always loaded
import { HeavyChart } from './heavy-chart'

// ✅ lazy loaded
const HeavyChart = lazy(() => import('./heavy-chart'))
```

### Defer Non-Critical Third-Party Libraries
Load analytics/logging after initial render.

### Conditional Module Loading
Load modules only when feature is activated.

### Preload on User Intent
Preload on hover/focus for perceived speed.

## 3. Client-Side Data Fetching (MEDIUM-HIGH)

### Deduplicate Global Event Listeners

```typescript
// ❌ each instance adds a listener
function useWindowSize() {
  useEffect(() => {
    const handler = () => setSize(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
}

// ✅ shared listener via useSyncExternalStore
const listeners = new Set<() => void>()
let width = window.innerWidth
window.addEventListener('resize', () => {
  width = window.innerWidth
  listeners.forEach(l => l())
})

function useWindowWidth() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => width
  )
}
```

### Use Passive Event Listeners for Scroll

```typescript
element.addEventListener('scroll', handler, { passive: true })
```

## 4. Re-render Optimization (MEDIUM)

### Defer State Reads
Don't subscribe to state only used in callbacks.

```tsx
// ❌ re-renders on every items change
function List({ items }: { items: Item[] }) {
  const handleExport = () => exportItems(items)
  return <Button onClick={handleExport}>Export</Button>
}

// ✅ read at call time via ref
function List({ items }: { items: Item[] }) {
  const itemsRef = useRef(items)
  itemsRef.current = items
  const handleExport = useCallback(() => exportItems(itemsRef.current), [])
  return <Button onClick={handleExport}>Export</Button>
}
```

### Extract to Memoized Components
Wrap expensive subtrees in `memo()`.

### Hoist Default Non-primitive Props

```tsx
// ❌ new object every render breaks memo
<MemoizedChild config={{ theme: 'dark' }} />

// ✅ hoist to module scope
const DEFAULT_CONFIG = { theme: 'dark' }
<MemoizedChild config={DEFAULT_CONFIG} />
```

### Derive State During Render, Not Effects

```tsx
// ❌ useEffect to derive state
const [filteredItems, setFilteredItems] = useState(items)
useEffect(() => { setFilteredItems(items.filter(i => i.active)) }, [items])

// ✅ derive during render
const filteredItems = useMemo(() => items.filter(i => i.active), [items])
```

### Subscribe to Derived Booleans

```tsx
// ❌ re-renders when count changes from 5→6
const count = useStore(s => s.items.length)
return count > 0 ? <Badge /> : null

// ✅ only re-renders when boolean flips
const hasItems = useStore(s => s.items.length > 0)
return hasItems ? <Badge /> : null
```

### Functional setState for Stable Callbacks

```tsx
// ❌ new callback every render
const increment = () => setCount(count + 1)

// ✅ stable callback
const increment = useCallback(() => setCount(c => c + 1), [])
```

### Lazy State Initialization

```tsx
// ❌ runs expensive computation every render
const [data] = useState(expensiveComputation())

// ✅ runs once
const [data] = useState(() => expensiveComputation())
```

### Use Transitions for Non-Urgent Updates

```tsx
const [isPending, startTransition] = useTransition()
const handleSearch = (value: string) => {
  setQuery(value) // immediate
  startTransition(async () => {
    const data = await fetchResults(value)
    setResults(data)
  })
}
```

### Use useRef for Transient Values
Use refs for values that change frequently but don't need re-renders (mouse position, scroll offset).

## 5. Rendering Performance (MEDIUM)

### Hoist Static JSX

```tsx
// ❌ recreated every render
function Parent() {
  return <div><StaticHeader /><DynamicContent /></div>
}

// ✅ hoisted
const header = <StaticHeader />
function Parent() {
  return <div>{header}<DynamicContent /></div>
}
```

### CSS content-visibility for Long Lists

```css
.list-item { content-visibility: auto; contain-intrinsic-size: 0 50px; }
```

### Use Explicit Conditional Rendering

```tsx
// ❌ renders "0" when count is 0
{count && <Badge>{count}</Badge>}

// ✅ renders nothing when count is 0
{count > 0 ? <Badge>{count}</Badge> : null}
```

### Animate Wrapper, Not SVG Element
Apply CSS transforms to a `<div>` wrapper around SVG, not the `<svg>` element itself.

## 6. JavaScript Performance (LOW-MEDIUM)

### Avoid Layout Thrashing
Don't interleave style writes with layout reads. Batch writes, then read.

### Build Index Maps for Repeated Lookups

```typescript
// ❌ O(n) per lookup
users.find(u => u.id === order.userId)

// ✅ O(1) per lookup
const userById = new Map(users.map(u => [u.id, u]))
userById.get(order.userId)
```

### Combine Multiple Array Iterations

```typescript
// ❌ 3 iterations
const admins = users.filter(u => u.isAdmin)
const testers = users.filter(u => u.isTester)

// ✅ 1 iteration
const admins: User[] = [], testers: User[] = []
for (const user of users) {
  if (user.isAdmin) admins.push(user)
  if (user.isTester) testers.push(user)
}
```

### Use Set/Map for O(1) Lookups

```typescript
const allowedIds = new Set(['a', 'b', 'c'])
items.filter(item => allowedIds.has(item.id))
```

### Use toSorted() for Immutability

```typescript
// ❌ mutates original
users.sort((a, b) => a.name.localeCompare(b.name))

// ✅ immutable
users.toSorted((a, b) => a.name.localeCompare(b.name))
```

### Hoist RegExp Creation
Don't create RegExp inside render. Hoist to module scope or `useMemo`.

### Early Return from Functions
Return early when result is determined.

## 7. Advanced Patterns (LOW)

### Initialize App Once, Not Per Mount

```tsx
let didInit = false
function App() {
  useEffect(() => {
    if (didInit) return
    didInit = true
    loadFromStorage()
  }, [])
}
```

### useEffectEvent for Stable Callbacks

```tsx
import { useEffectEvent } from 'react'
function SearchInput({ onSearch }: { onSearch: (q: string) => void }) {
  const [query, setQuery] = useState('')
  const onSearchEvent = useEffectEvent(onSearch)
  useEffect(() => {
    const timeout = setTimeout(() => onSearchEvent(query), 300)
    return () => clearTimeout(timeout)
  }, [query])
}
```
