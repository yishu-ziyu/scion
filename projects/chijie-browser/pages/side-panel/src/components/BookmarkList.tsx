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
  skillRunDisabled?: boolean;
  isDarkMode?: boolean;
}

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
  onSkillRun,
  onBookmarkUpdateTitle,
  onBookmarkDelete,
  onBookmarkReorder,
  skillRunDisabled = false,
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
    if (skillRunDisabled) return;
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

  if (bookmarks.length === 0) return null;

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
              <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="chijie-field min-w-0 grow text-sm"
                />
                <button
                  onClick={() => handleSaveEdit(bookmark.id)}
                  className="flex size-10 shrink-0 items-center justify-center rounded bg-[var(--chijie-surface)] text-[var(--chijie-accent)] hover:bg-[var(--chijie-accent-subtle)] focus-visible:opacity-100"
                  aria-label={t('chat_bookmarks_saveEdit')}
                  type="button">
                  <FaCheck size={16} aria-hidden />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="flex size-10 shrink-0 items-center justify-center rounded bg-[var(--chijie-surface)] text-[var(--chijie-danger)] hover:bg-[var(--chijie-danger-subtle)] focus-visible:opacity-100"
                  aria-label={t('chat_bookmarks_cancelEdit')}
                  type="button">
                  <FaTimes size={16} aria-hidden />
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {bookmark.kind === 'skill' ? (
                    <>
                      <div className="truncate pr-20 text-sm font-medium text-[var(--chijie-foreground)]">
                        {bookmark.title}
                      </div>
                      {skillDraft.runningSkillId === bookmark.id ? (
                        <>
                          {bookmark.inputs.map(input => (
                            <label
                              key={input.name}
                              className="flex flex-col gap-1 text-xs text-[var(--chijie-paper-muted)]">
                              {input.label}
                              <input
                                data-testid={`skill-input-${input.name}`}
                                value={skillDraft.values[input.name] ?? ''}
                                disabled={skillRunDisabled}
                                onChange={event =>
                                  dispatchSkillDraft({
                                    type: 'value_changed',
                                    name: input.name,
                                    value: event.target.value,
                                  })
                                }
                                className="chijie-field px-2"
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            data-testid="skill-run-confirm"
                            disabled={skillRunDisabled}
                            aria-busy={skillRunDisabled}
                            onClick={() => handleRunSkill(bookmark)}
                            className="chijie-btn-primary">
                            {t('chat_skills_runConfirm')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          data-testid="skill-run"
                          disabled={skillRunDisabled}
                          aria-busy={skillRunDisabled}
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
                      className="min-h-10 w-full pr-20 text-left">
                      <div className="truncate text-sm font-medium text-[var(--chijie-foreground)]">
                        {bookmark.title}
                      </div>
                    </button>
                  )}
                </div>
              </>
            )}

            {editingId !== bookmark.id && (
              <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2">
                {/* Edit button - top right */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    handleEditClick(bookmark);
                  }}
                  className="flex size-10 items-center justify-center rounded bg-[var(--chijie-surface)] text-[var(--chijie-accent)] opacity-100 transition-colors duration-200 hover:bg-[var(--chijie-accent-subtle)] focus-visible:opacity-100"
                  aria-label={t('chat_bookmarks_edit')}
                  type="button">
                  <FaPen size={16} aria-hidden />
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
                  className="flex size-10 items-center justify-center rounded bg-[var(--chijie-surface)] text-[var(--chijie-danger)] opacity-100 transition-colors duration-200 hover:bg-[var(--chijie-danger-subtle)] focus-visible:opacity-100"
                  aria-label={t('chat_bookmarks_delete')}
                  type="button">
                  <FaTrash size={16} aria-hidden />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookmarkList;
