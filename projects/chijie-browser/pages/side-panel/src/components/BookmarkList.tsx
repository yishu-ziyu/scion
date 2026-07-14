/* eslint-disable react/prop-types */
import { useState, useRef, useEffect, useReducer } from 'react';
import { FaTrash, FaPen, FaCheck, FaTimes } from 'react-icons/fa';
import { t } from '@extension/i18n';
import type { FavoriteItem, FavoriteSkill } from '@extension/storage/lib/prompt/favorites';
import { emptySkillDraft, reduceSkillDraft } from './skill-draft';

interface BookmarkListProps {
  bookmarks: FavoriteItem[];
  onBookmarkSelect: (content: string) => void;
  onSkillRun: (skill: FavoriteSkill, values: Record<string, string>) => void;
  onBookmarkUpdateTitle?: (id: number, title: string) => void;
  onBookmarkDelete?: (id: number) => void;
  onBookmarkReorder?: (draggedId: number, targetId: number) => void;
  isDarkMode?: boolean;
}

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
  onSkillRun,
  onBookmarkUpdateTitle,
  onBookmarkDelete,
  onBookmarkReorder,
  isDarkMode = false,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [skillDraft, dispatchSkillDraft] = useReducer(reduceSkillDraft, emptySkillDraft);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEditClick = (bookmark: FavoriteItem) => {
    dispatchSkillDraft({ type: 'editing' });
    setEditingId(bookmark.id);
    setEditTitle(bookmark.title);
  };

  const handleRunSkill = (skill: FavoriteSkill) => {
    const values = skillDraft.values;
    dispatchSkillDraft({ type: 'submitted' });
    onSkillRun(skill, values);
  };

  const handleSaveEdit = (id: number) => {
    if (onBookmarkUpdateTitle && editTitle.trim()) {
      onBookmarkUpdateTitle(id, editTitle);
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    // Add more transparent effect
    e.currentTarget.classList.add('opacity-25');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-25');
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    if (onBookmarkReorder) {
      onBookmarkReorder(draggedId, targetId);
    }
  };

  // Focus the input field when entering edit mode
  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  const hasSkills = bookmarks.some(item => item.kind === 'skill');

  return (
    <div className="p-3" data-testid="bookmark-list">
      <h3>{hasSkills ? t('chat_bookmarks_skills_header') : t('chat_bookmarks_header')}</h3>
      <div className="grid grid-cols-1 gap-3">
        {bookmarks.map(bookmark => (
          <div
            key={bookmark.id}
            draggable={editingId !== bookmark.id}
            onDragStart={e => handleDragStart(e, bookmark.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, bookmark.id)}
            className="chijie-bookmark-item group relative">
            {editingId === bookmark.id ? (
              <div className="flex items-center">
                <input
                  ref={inputRef}
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className={`mr-2 grow rounded px-2 py-1 text-sm ${
                    isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'
                  } border`}
                />
                <button
                  onClick={() => handleSaveEdit(bookmark.id)}
                  className={`rounded p-1 ${
                    isDarkMode
                      ? 'bg-slate-700 text-green-400 hover:bg-slate-600'
                      : 'bg-white text-green-500 hover:bg-gray-100'
                  }`}
                  aria-label={t('chat_bookmarks_saveEdit')}
                  type="button">
                  <FaCheck size={14} />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className={`ml-1 rounded p-1 ${
                    isDarkMode
                      ? 'bg-slate-700 text-red-400 hover:bg-slate-600'
                      : 'bg-white text-red-500 hover:bg-gray-100'
                  }`}
                  aria-label={t('chat_bookmarks_cancelEdit')}
                  type="button">
                  <FaTimes size={14} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {bookmark.kind === 'skill' ? (
                    <>
                      <div
                        className={`truncate pr-10 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {bookmark.title}
                      </div>
                      {skillDraft.runningSkillId === bookmark.id ? (
                        <>
                          {bookmark.inputs.map(input => (
                            <label key={input.name} className="flex flex-col gap-1 text-xs">
                              {input.label}
                              <input
                                data-testid={`skill-input-${input.name}`}
                                value={skillDraft.values[input.name] ?? ''}
                                onChange={event =>
                                  dispatchSkillDraft({
                                    type: 'value_changed',
                                    name: input.name,
                                    value: event.target.value,
                                  })
                                }
                                className={`rounded border px-2 py-1 ${
                                  isDarkMode
                                    ? 'border-slate-600 bg-slate-700 text-gray-200'
                                    : 'border-sky-100 bg-white text-gray-700'
                                }`}
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            data-testid="skill-run-confirm"
                            onClick={() => handleRunSkill(bookmark)}
                            className="chijie-btn-primary">
                            {t('chat_skills_runConfirm')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          data-testid="skill-run"
                          onClick={() => dispatchSkillDraft({ type: 'opened', skillId: bookmark.id })}
                          className="chijie-btn-primary">
                          {t('chat_skills_run')}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBookmarkSelect(bookmark.content)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') onBookmarkSelect(bookmark.content);
                      }}
                      className="w-full text-left">
                      <div
                        className={`truncate pr-10 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {bookmark.title}
                      </div>
                    </button>
                  )}
                </div>
              </>
            )}

            {editingId !== bookmark.id && (
              <>
                {/* Edit button - top right */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    handleEditClick(bookmark);
                  }}
                  className={`absolute right-[28px] top-1/2 z-10 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
                    isDarkMode
                      ? 'bg-slate-700 text-sky-400 hover:bg-slate-600'
                      : 'bg-white text-sky-500 hover:bg-gray-100'
                  }`}
                  aria-label={t('chat_bookmarks_edit')}
                  type="button">
                  <FaPen size={14} />
                </button>

                {/* Delete button - bottom right */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    dispatchSkillDraft({ type: 'deleted' });
                    if (onBookmarkDelete) {
                      onBookmarkDelete(bookmark.id);
                    }
                  }}
                  className={`absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
                    isDarkMode
                      ? 'bg-slate-700 text-gray-400 hover:bg-slate-600'
                      : 'bg-white text-gray-500 hover:bg-gray-100'
                  }`}
                  aria-label={t('chat_bookmarks_delete')}
                  type="button">
                  <FaTrash size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookmarkList;
