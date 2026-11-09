import Rules from './Rules'
import Settings from './Settings'
import CategoryManager from '../components/CategoryManager'
import StandingAdjustments from '../components/StandingAdjustments'

export default function Setup() {
  return (
    <>
      <div className="page-head">
        <h1>Setup</h1>
      </div>
      <div className="setup-sections">
        <Rules />
        <CategoryManager />
        <StandingAdjustments />
        <Settings />
      </div>
    </>
  )
}
