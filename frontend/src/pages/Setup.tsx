import BudgetPlanner from '../components/BudgetPlanner'
import Rules from './Rules'
import Settings from './Settings'
import CategoryManager from '../components/CategoryManager'
import SetAsides from '../components/SetAsides'
import TargetSplit from '../components/TargetSplit'
import OwnNames from '../components/OwnNames'
import YourData from '../components/reports/YourData'

export default function Setup() {
  return (
    <>
      <div className="page-head">
        <h1>Setup</h1>
      </div>
      <div className="setup-sections">
        <BudgetPlanner />
        <Rules />
        <CategoryManager />
        <SetAsides />
        <TargetSplit />
        <OwnNames />
        <Settings />
        <YourData />
      </div>
    </>
  )
}
