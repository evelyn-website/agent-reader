import { useState } from 'react'
import PDFViewer from './components/PDFViewer'
import './assets/main.css'

interface PdfFile {
  path: string
  data: Buffer
}

export default function App(): React.JSX.Element {
  const [pdf, setPdf] = useState<PdfFile | null>(null)

  const handleOpen = async (): Promise<void> => {
    const path = await window.api.openPdf()
    if (!path) return
    const data = await window.api.readPdf(path)
    setPdf({ path, data })
  }

  return (
    <div className="app-layout">
      <div className="toolbar">
        <button onClick={handleOpen}>Open PDF</button>
        {pdf && <span className="pdf-filename">{pdf.path.split('/').pop()}</span>}
      </div>
      <div className="main-area">
        {pdf ? (
          <PDFViewer data={pdf.data} />
        ) : (
          <div className="empty-state">
            <p>Open a PDF to get started</p>
          </div>
        )}
      </div>
    </div>
  )
}
