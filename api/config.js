export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    processorUrl: process.env.PROCESSOR_URL || ''
  });
}
