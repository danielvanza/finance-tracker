import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'

// findBy* waits 1s by default, which a busy machine's first render can exceed.
configure({ asyncUtilTimeout: 5000 })
