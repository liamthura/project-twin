import { useState, useEffect, useCallback, useRef } from 'react'

// API Configuration
const API_BASE = '/api'

// API Helper
async function api(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`)
  }
  return response.json()
}

// Debounce hook for auto-save
function useDebounce(callback, delay) {
  const timeoutRef = useRef(null)
  
  const debouncedCallback = useCallback((...args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args)
    }, delay)
  }, [callback, delay])
  
  return debouncedCallback
}

// Array Input Component
function ArrayInput({ items = [], onChange, placeholder }) {
  const [newItem, setNewItem] = useState('')

  const addItem = () => {
    if (newItem.trim()) {
      onChange([...items, newItem.trim()])
      setNewItem('')
    }
  }

  const removeItem = (index) => {
    onChange(items.filter((_, i) => i !== index))
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem()
    }
  }

  return (
    <div className="array-field">
      <div className="array-items">
        {items.map((item, index) => (
          <div key={index} className="array-item">
            <span>{item}</span>
            <button onClick={() => removeItem(index)}>×</button>
          </div>
        ))}
      </div>
      <div className="array-input-row">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={placeholder || 'Add item...'}
        />
        <button className="btn btn-primary btn-small" onClick={addItem}>+ Add</button>
      </div>
    </div>
  )
}

// Profile Editor
function ProfileEditor({ data, onChange }) {
  const update = (field, value) => {
    onChange({ ...data, [field]: value })
  }

  const updateContact = (field, value) => {
    onChange({ ...data, contact: { ...(data.contact || {}), [field]: value } })
  }

  return (
    <div className="editor-panel">
      <h2 className="section-title">Profile</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Name</label>
          <input
            type="text"
            value={data.name || ''}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Your name"
          />
        </div>
        <div className="form-group">
          <label>Current Role</label>
          <input
            type="text"
            value={data.current_role || ''}
            onChange={(e) => update('current_role', e.target.value)}
            placeholder="e.g. Software Engineer at Company"
          />
        </div>
        <div className="form-group">
          <label>Organisation</label>
          <input
            type="text"
            value={data.organisation || ''}
            onChange={(e) => update('organisation', e.target.value)}
            placeholder="Company or university"
          />
        </div>
        <div className="form-group">
          <label>Location</label>
          <input
            type="text"
            value={data.location || ''}
            onChange={(e) => update('location', e.target.value)}
            placeholder="City, Country"
          />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            value={data.contact?.email || ''}
            onChange={(e) => updateContact('email', e.target.value)}
            placeholder="your@email.com"
          />
        </div>
        <div className="form-group">
          <label>GitHub Username</label>
          <input
            type="text"
            value={data.contact?.github || ''}
            onChange={(e) => updateContact('github', e.target.value)}
            placeholder="username"
          />
        </div>
        <div className="form-group full-width">
          <label>Languages Spoken</label>
          <ArrayInput
            items={data.languages_spoken || []}
            onChange={(items) => update('languages_spoken', items)}
            placeholder="Add language..."
          />
        </div>
        <div className="form-group full-width">
          <label>Bio</label>
          <textarea
            value={data.bio || ''}
            onChange={(e) => update('bio', e.target.value)}
            placeholder="A brief description of who you are..."
          />
        </div>
      </div>
    </div>
  )
}

// Knowledge Editor
function KnowledgeEditor({ data, onChange }) {
  const levels = ['beginner', 'learning', 'intermediate', 'advanced', 'expert']

  const addDomain = () => {
    const newDomains = [...(data.domains || []), { name: '', level: 'learning', notes: '' }]
    onChange({ ...data, domains: newDomains })
  }

  const updateDomain = (index, field, value) => {
    const newDomains = [...(data.domains || [])]
    newDomains[index] = { ...newDomains[index], [field]: value }
    onChange({ ...data, domains: newDomains })
  }

  const removeDomain = (index) => {
    onChange({ ...data, domains: (data.domains || []).filter((_, i) => i !== index) })
  }

  return (
    <div className="editor-panel">
      <h2 className="section-title">Knowledge Domains</h2>
      {(data.domains || []).map((domain, index) => (
        <div key={index} className="card">
          <div className="card-header">
            <div style={{ flex: 1 }} />
            <button className="btn btn-danger btn-icon" onClick={() => removeDomain(index)}>×</button>
          </div>
          <div className="card-grid">
            <div className="form-group">
              <label>Domain / Skill</label>
              <input
                type="text"
                value={domain.name || ''}
                onChange={(e) => updateDomain(index, 'name', e.target.value)}
                placeholder="e.g. Python, Docker, React"
              />
            </div>
            <div className="form-group">
              <label>Proficiency Level</label>
              <select
                value={domain.level || 'learning'}
                onChange={(e) => updateDomain(index, 'level', e.target.value)}
              >
                {levels.map((level) => (
                  <option key={level} value={level}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label>Notes</label>
            <input
              type="text"
              value={domain.notes || ''}
              onChange={(e) => updateDomain(index, 'notes', e.target.value)}
              placeholder="Additional context about this skill..."
            />
          </div>
        </div>
      ))}
      <button className="add-card-btn" onClick={addDomain}>
        + Add Knowledge Domain
      </button>
    </div>
  )
}

// Preferences Editor
function PreferencesEditor({ data, onChange }) {
  const updateCodeStyle = (field, value) => {
    onChange({
      ...data,
      code_style: { ...(data.code_style || {}), [field]: value }
    })
  }

  const updateCommunication = (field, value) => {
    onChange({
      ...data,
      communication: { ...(data.communication || {}), [field]: value }
    })
  }

  const updateLearning = (field, value) => {
    onChange({
      ...data,
      learning_style: { ...(data.learning_style || {}), [field]: value }
    })
  }

  return (
    <div className="editor-panel">
      <h2 className="section-title">Code Style</h2>
      <div className="form-grid">
        <div className="form-group full-width">
          <label>Preferred Languages</label>
          <ArrayInput
            items={data.code_style?.preferred_languages || []}
            onChange={(items) => updateCodeStyle('preferred_languages', items)}
            placeholder="e.g. Python, TypeScript..."
          />
        </div>
        <div className="form-group full-width">
          <label>Frameworks</label>
          <ArrayInput
            items={data.code_style?.frameworks || []}
            onChange={(items) => updateCodeStyle('frameworks', items)}
            placeholder="e.g. FastAPI, Next.js..."
          />
        </div>
        <div className="form-group full-width">
          <label>Tools</label>
          <ArrayInput
            items={data.code_style?.tools || []}
            onChange={(items) => updateCodeStyle('tools', items)}
            placeholder="e.g. VS Code, Docker..."
          />
        </div>
      </div>

      <h2 className="section-title" style={{ marginTop: '2rem' }}>Communication</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Tone</label>
          <input
            type="text"
            value={data.communication?.tone || ''}
            onChange={(e) => updateCommunication('tone', e.target.value)}
            placeholder="e.g. friendly but professional"
          />
        </div>
        <div className="form-group">
          <label>Detail Level</label>
          <input
            type="text"
            value={data.communication?.detail_level || ''}
            onChange={(e) => updateCommunication('detail_level', e.target.value)}
            placeholder="e.g. comprehensive with examples"
          />
        </div>
        <div className="form-group">
          <label>Locale</label>
          <input
            type="text"
            value={data.communication?.locale || ''}
            onChange={(e) => updateCommunication('locale', e.target.value)}
            placeholder="e.g. British English"
          />
        </div>
      </div>

      <h2 className="section-title" style={{ marginTop: '2rem' }}>Learning Style</h2>
      <div className="form-grid">
        <div className="form-group full-width">
          <label>Preferred Methods</label>
          <ArrayInput
            items={data.learning_style?.preferred || []}
            onChange={(items) => updateLearning('preferred', items)}
            placeholder="e.g. hands-on examples..."
          />
        </div>
        <div className="form-group full-width">
          <label>Things to Avoid</label>
          <ArrayInput
            items={data.learning_style?.avoid || []}
            onChange={(items) => updateLearning('avoid', items)}
            placeholder="e.g. walls of text..."
          />
        </div>
      </div>
    </div>
  )
}

// Projects Editor
function ProjectsEditor({ data, onChange }) {
  const addProject = () => {
    const newProjects = [
      ...(data.projects || []),
      { name: '', description: '', status: 'active', tech_stack: [] }
    ]
    onChange({ ...data, projects: newProjects })
  }

  const updateProject = (index, field, value) => {
    const newProjects = [...(data.projects || [])]
    newProjects[index] = { ...newProjects[index], [field]: value }
    onChange({ ...data, projects: newProjects })
  }

  const removeProject = (index) => {
    onChange({ ...data, projects: (data.projects || []).filter((_, i) => i !== index) })
  }

  return (
    <div className="editor-panel">
      <h2 className="section-title">Projects</h2>
      {(data.projects || []).map((project, index) => (
        <div key={index} className="card">
          <div className="card-header">
            <div style={{ flex: 1 }} />
            <button className="btn btn-danger btn-icon" onClick={() => removeProject(index)}>×</button>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Project Name</label>
              <input
                type="text"
                value={project.name || ''}
                onChange={(e) => updateProject(index, 'name', e.target.value)}
                placeholder="Project name"
              />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select
                value={project.status || 'active'}
                onChange={(e) => updateProject(index, 'status', e.target.value)}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="form-group full-width">
              <label>Description</label>
              <textarea
                value={project.description || ''}
                onChange={(e) => updateProject(index, 'description', e.target.value)}
                placeholder="Brief description..."
              />
            </div>
            <div className="form-group full-width">
              <label>Tech Stack</label>
              <ArrayInput
                items={project.tech_stack || []}
                onChange={(items) => updateProject(index, 'tech_stack', items)}
                placeholder="Add technology..."
              />
            </div>
          </div>
        </div>
      ))}
      <button className="add-card-btn" onClick={addProject}>
        + Add Project
      </button>

      <h2 className="section-title" style={{ marginTop: '2rem' }}>Top of Mind</h2>
      <ArrayInput
        items={data.top_of_mind || []}
        onChange={(items) => onChange({ ...data, top_of_mind: items })}
        placeholder="What's on your mind right now..."
      />
    </div>
  )
}

// Interests Editor
function InterestsEditor({ data, onChange }) {
  const addHobby = () => {
    const newHobbies = [
      ...(data.hobbies || []),
      { name: '', specifics: [], skill_level: 'enthusiast' }
    ]
    onChange({ ...data, hobbies: newHobbies })
  }

  const updateHobby = (index, field, value) => {
    const newHobbies = [...(data.hobbies || [])]
    newHobbies[index] = { ...newHobbies[index], [field]: value }
    onChange({ ...data, hobbies: newHobbies })
  }

  const removeHobby = (index) => {
    onChange({ ...data, hobbies: (data.hobbies || []).filter((_, i) => i !== index) })
  }

  return (
    <div className="editor-panel">
      <h2 className="section-title">Hobbies</h2>
      {(data.hobbies || []).map((hobby, index) => (
        <div key={index} className="card">
          <div className="card-header">
            <div style={{ flex: 1 }} />
            <button className="btn btn-danger btn-icon" onClick={() => removeHobby(index)}>×</button>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Hobby</label>
              <input
                type="text"
                value={hobby.name || ''}
                onChange={(e) => updateHobby(index, 'name', e.target.value)}
                placeholder="e.g. Cooking, Gaming"
              />
            </div>
            <div className="form-group">
              <label>Skill Level</label>
              <select
                value={hobby.skill_level || 'enthusiast'}
                onChange={(e) => updateHobby(index, 'skill_level', e.target.value)}
              >
                <option value="casual">Casual</option>
                <option value="enthusiast">Enthusiast</option>
                <option value="serious">Serious</option>
                <option value="expert">Expert</option>
              </select>
            </div>
            <div className="form-group full-width">
              <label>Specifics</label>
              <ArrayInput
                items={hobby.specifics || []}
                onChange={(items) => updateHobby(index, 'specifics', items)}
                placeholder="e.g. Asian cuisine, strategy games..."
              />
            </div>
          </div>
        </div>
      ))}
      <button className="add-card-btn" onClick={addHobby}>
        + Add Hobby
      </button>

      <h2 className="section-title" style={{ marginTop: '2rem' }}>Passions</h2>
      <ArrayInput
        items={data.passions || []}
        onChange={(items) => onChange({ ...data, passions: items })}
        placeholder="Things you're passionate about..."
      />

      <h2 className="section-title" style={{ marginTop: '2rem' }}>Curiosities</h2>
      <ArrayInput
        items={data.curiosities || []}
        onChange={(items) => onChange({ ...data, curiosities: items })}
        placeholder="Things you're curious about..."
      />
    </div>
  )
}

// Toast Component
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div className={`toast ${type}`}>
      {type === 'success' && '✓ '}
      {type === 'error' && '✕ '}
      {message}
    </div>
  )
}

// Main App
export default function App() {
  const [activeTab, setActiveTab] = useState('profile')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [hasChanges, setHasChanges] = useState({})
  const [lastSaved, setLastSaved] = useState(null)

  // Data state
  const [profile, setProfile] = useState({})
  const [knowledge, setKnowledge] = useState({})
  const [preferences, setPreferences] = useState({})
  const [projects, setProjects] = useState({})
  const [interests, setInterests] = useState({})

  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'knowledge', label: 'Knowledge' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'projects', label: 'Projects' },
    { id: 'interests', label: 'Interests' },
  ]

  // Load all data on mount
  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await api('/all')
      setProfile(response.data.profile || {})
      setKnowledge(response.data.knowledge || {})
      setPreferences(response.data.preferences || {})
      setProjects(response.data.projects || {})
      setInterests(response.data.interests || {})
      setIsConnected(true)
      setHasChanges({})
    } catch (err) {
      setError(err.message)
      setIsConnected(false)
    } finally {
      setIsLoading(false)
    }
  }

  // Save function
  const saveFile = async (fileType, data) => {
    setIsSaving(true)
    try {
      await api(`/files/${fileType}`, {
        method: 'PUT',
        body: JSON.stringify({ data }),
      })
      setHasChanges(prev => ({ ...prev, [fileType]: false }))
      setLastSaved(new Date())
      showToast('Saved', 'success')
    } catch (err) {
      showToast(`Failed to save: ${err.message}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // Debounced auto-save
  const debouncedSave = useDebounce(saveFile, 1500)

  // Change handlers with auto-save
  const handleProfileChange = (newData) => {
    setProfile(newData)
    setHasChanges(prev => ({ ...prev, profile: true }))
    debouncedSave('profile', newData)
  }

  const handleKnowledgeChange = (newData) => {
    setKnowledge(newData)
    setHasChanges(prev => ({ ...prev, knowledge: true }))
    debouncedSave('knowledge', newData)
  }

  const handlePreferencesChange = (newData) => {
    setPreferences(newData)
    setHasChanges(prev => ({ ...prev, preferences: true }))
    debouncedSave('preferences', newData)
  }

  const handleProjectsChange = (newData) => {
    setProjects(newData)
    setHasChanges(prev => ({ ...prev, projects: true }))
    debouncedSave('projects', newData)
  }

  const handleInterestsChange = (newData) => {
    setInterests(newData)
    setHasChanges(prev => ({ ...prev, interests: true }))
    debouncedSave('interests', newData)
  }

  const showToast = (message, type = 'info') => {
    setToast({ message, type })
  }

  const saveAll = async () => {
    setIsSaving(true)
    try {
      await api('/all', {
        method: 'PUT',
        body: JSON.stringify({
          profile,
          knowledge,
          preferences,
          projects,
          interests,
        }),
      })
      setHasChanges({})
      setLastSaved(new Date())
      showToast('All files saved', 'success')
    } catch (err) {
      showToast(`Failed to save: ${err.message}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner" />
          <p>Connecting to backend...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="app">
        <header>
          <div className="header-content">
            <h1>Persona Manager</h1>
            <p>Build your digital persona for personalised AI interactions</p>
          </div>
        </header>
        <div className="error-state">
          <h2>Connection Failed</h2>
          <p>Could not connect to the backend server.</p>
          <button className="btn btn-primary" onClick={loadAllData}>
            Retry Connection
          </button>
          <code>
            Make sure the backend is running:{'\n'}
            cd backend{'\n'}
            pip install -r requirements.txt{'\n'}
            python main.py
          </code>
        </div>
      </div>
    )
  }

  const anyChanges = Object.values(hasChanges).some(Boolean)

  return (
    <div className="app">
      <header>
        <div className="header-content">
          <h1>Persona Manager</h1>
          <p>Build your digital persona for personalised AI interactions</p>
        </div>
        <div className="connection-status">
          <span className={`status-dot ${isConnected ? (isSaving ? 'saving' : 'connected') : ''}`} />
          {isSaving ? 'Saving...' : isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''} ${hasChanges[tab.id] ? 'has-changes' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <ProfileEditor data={profile} onChange={handleProfileChange} />
      )}

      {activeTab === 'knowledge' && (
        <KnowledgeEditor data={knowledge} onChange={handleKnowledgeChange} />
      )}

      {activeTab === 'preferences' && (
        <PreferencesEditor data={preferences} onChange={handlePreferencesChange} />
      )}

      {activeTab === 'projects' && (
        <ProjectsEditor data={projects} onChange={handleProjectsChange} />
      )}

      {activeTab === 'interests' && (
        <InterestsEditor data={interests} onChange={handleInterestsChange} />
      )}

      <div className="actions-bar">
        <button className="btn btn-primary" onClick={saveAll} disabled={isSaving || !anyChanges}>
          {isSaving ? 'Saving...' : 'Save All'}
        </button>
        <button className="btn btn-secondary" onClick={loadAllData}>
          ↻ Reload
        </button>
        <div className="save-status">
          {lastSaved && `Last saved: ${lastSaved.toLocaleTimeString()}`}
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}
