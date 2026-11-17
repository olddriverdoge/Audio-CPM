/* ============================================================
 * Audio-CPM Web v3 · 前端（命名空间 IIFE，无构建）
 * Api / Store / Utils / PlayMgr / ThumbMgr / BrowseView
 * TaskRunner / MetaView / TreeView / MoveMgr / Layout / App
 * ============================================================ */

/* ---------------- 存储 key ---------------- */
const K = {
  lastPath:'ac2_last_path', s2LastPath:'ac2_s2_last_path', viewMode:'ac2_view_mode', gridSize:'ac2_grid_size',
  sortBy:'ac2_sort_by', sortOrder:'ac2_sort_order', folderOrder:'ac2_folder_order',
  conflict:'ac2_conflict_mode',
  recent:'ac2_recent_paths', played:'ac2_played',
  split2:'ac2_layout_split2', split3:'ac2_layout_split3',
  page:'ac2_page',
  targetPath:'ac2_target_path',
  s2SortBy:'ac2_s2_sort_by', s2SortOrder:'ac2_s2_sort_order',
  playerPkg:'ac2_player_pkg', playerAct:'ac2_player_activity',
  playMode:'ac2_play_mode',
  s2ViewMode:'ac2_s2_view_mode', moveCollapsed:'ac2_movebar_collapsed',
  metaCollapsed:'ac2_meta_collapsed', meta1Collapsed:'ac2_meta1_collapsed', columns:'ac2_columns',
  columns2:'ac2_columns_s2',
  treeRoots:'ac2_tree_roots', treeActive:'ac2_tree_active',
  treeCollapsed:'ac2_tree_collapsed',
  autoplay:'ac2_autoplay', spectrumSize:'ac2_spectrum_size', spectrumMode:'ac2_spectrum_mode',
  spectrumPos:'ac2_spectrum_pos', spectrumDelay:'ac2_spectrum_delay', spectrumX:'ac2_spectrum_x',
  spectrumDb:'ac2_spectrum_db', spectrumRel:'ac2_spectrum_rel', spectrumPeak:'ac2_spectrum_peak',
  spectrumBars:'ac2_spectrum_bars', spectrumStop:'ac2_spectrum_stop',
  wfBright:'ac2_wf_bright', wfTop:'ac2_wf_top', wfGrid:'ac2_wf_grid', wfPal:'ac2_wf_pal',
  wfBands:'ac2_wf_bands', wfY:'ac2_wf_y',
  metaPos:'ac2_meta_pos', metaSize:'ac2_meta_size', movePos:'ac2_move_pos'
};
