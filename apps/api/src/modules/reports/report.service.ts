// Report Service - 举报业务逻辑
import { 
  db, 
  reports, 
  users, 
  activities, 
  activityMessages, 
  eq, 
  and, 
  count, 
  desc 
} from '@juchang/db';
import type { 
  CreateReportRequest, 
  ReportListQuery, 
  ReportListResponse, 
  ReportResponse,
  UpdateReportRequest,
  ReportType,
} from './report.model';

/**
 * 获取被举报内容的快照
 * 根据举报类型和目标 ID 获取对应的内容
 */
async function getTargetContentSnapshot(
  type: ReportType, 
  targetId: string
): Promise<string> {
  switch (type) {
    case 'activity': {
      const [activity] = await db
        .select({
          title: activities.title,
          description: activities.description,
          locationName: activities.locationName,
        })
        .from(activities)
        .where(eq(activities.id, targetId))
        .limit(1);
      
      if (!activity) {
        return `[活动已删除] ID: ${targetId}`;
      }
      
      return JSON.stringify({
        title: activity.title,
        description: activity.description,
        locationName: activity.locationName,
      });
    }
    
    case 'message': {
      const [message] = await db
        .select({
          content: activityMessages.content,
          messageType: activityMessages.messageType,
          senderId: activityMessages.senderId,
        })
        .from(activityMessages)
        .where(eq(activityMessages.id, targetId))
        .limit(1);
      
      if (!message) {
        return `[消息已删除] ID: ${targetId}`;
      }
      
      return JSON.stringify({
        content: message.content,
        messageType: message.messageType,
        senderId: message.senderId,
      });
    }
    
    case 'user': {
      const [user] = await db
        .select({
          nickname: users.nickname,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      
      if (!user) {
        return `[用户已删除] ID: ${targetId}`;
      }
      
      return JSON.stringify({
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
      });
    }
    
    default:
      return `[未知类型] ID: ${targetId}`;
  }
}

/**
 * 创建举报 (小程序端)
 */
export async function createReport(
  data: CreateReportRequest,
  reporterId: string
): Promise<{ id: string }> {
  // 获取被举报内容的快照
  const targetContent = await getTargetContentSnapshot(data.type, data.targetId);
  
  // 创建举报记录
  const [report] = await db
    .insert(reports)
    .values({
      type: data.type,
      reason: data.reason,
      description: data.description || null,
      targetId: data.targetId,
      targetContent,
      reporterId,
      status: 'pending',
    })
    .returning({ id: reports.id });
  
  return { id: report.id };
}

/**
 * 获取举报列表 (Admin)
 */
export async function getReports(
  query: ReportListQuery
): Promise<ReportListResponse> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const offset = (page - 1) * limit;
  
  // 构建查询条件
  const conditions = [];
  
  if (query.status) {
    conditions.push(eq(reports.status, query.status));
  }
  
  if (query.type) {
    conditions.push(eq(reports.type, query.type));
  }
  
  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;
  
  // 查询举报列表（包含举报人信息）
  const reportList = await db
    .select({
      id: reports.id,
      type: reports.type,
      reason: reports.reason,
      description: reports.description,
      targetId: reports.targetId,
      targetContent: reports.targetContent,
      reporterId: reports.reporterId,
      status: reports.status,
      adminNote: reports.adminNote,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
      resolvedBy: reports.resolvedBy,
      reporterNickname: users.nickname,
      reporterAvatarUrl: users.avatarUrl,
    })
    .from(reports)
    .leftJoin(users, eq(reports.reporterId, users.id))
    .where(whereCondition)
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset);
  
  // 查询总数
  const [totalResult] = await db
    .select({ total: count() })
    .from(reports)
    .where(whereCondition);
  
  // 转换为响应格式
  const data: ReportResponse[] = reportList.map(item => ({
    id: item.id,
    type: item.type,
    reason: item.reason,
    description: item.description,
    targetId: item.targetId,
    targetContent: item.targetContent,
    reporterId: item.reporterId,
    status: item.status,
    adminNote: item.adminNote,
    createdAt: item.createdAt.toISOString(),
    resolvedAt: item.resolvedAt?.toISOString() || null,
    resolvedBy: item.resolvedBy,
    reporter: {
      id: item.reporterId,
      nickname: item.reporterNickname,
      avatarUrl: item.reporterAvatarUrl,
    },
  }));
  
  return {
    items: data,
    total: totalResult?.total ?? 0,
    page,
    limit,
  };
}

/**
 * 根据 ID 获取举报详情 (Admin)
 */
export async function getReportById(id: string): Promise<ReportResponse | null> {
  const [report] = await db
    .select({
      id: reports.id,
      type: reports.type,
      reason: reports.reason,
      description: reports.description,
      targetId: reports.targetId,
      targetContent: reports.targetContent,
      reporterId: reports.reporterId,
      status: reports.status,
      adminNote: reports.adminNote,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
      resolvedBy: reports.resolvedBy,
      reporterNickname: users.nickname,
      reporterAvatarUrl: users.avatarUrl,
    })
    .from(reports)
    .leftJoin(users, eq(reports.reporterId, users.id))
    .where(eq(reports.id, id))
    .limit(1);
  
  if (!report) {
    return null;
  }
  
  return {
    id: report.id,
    type: report.type,
    reason: report.reason,
    description: report.description,
    targetId: report.targetId,
    targetContent: report.targetContent,
    reporterId: report.reporterId,
    status: report.status,
    adminNote: report.adminNote,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() || null,
    resolvedBy: report.resolvedBy,
    reporter: {
      id: report.reporterId,
      nickname: report.reporterNickname,
      avatarUrl: report.reporterAvatarUrl,
    },
  };
}

/**
 * 更新举报状态 (Admin)
 */
export async function updateReport(
  id: string,
  data: UpdateReportRequest,
  adminId: string
): Promise<ReportResponse | null> {
  // 检查举报是否存在
  const existingReport = await getReportById(id);
  if (!existingReport) {
    return null;
  }
  
  // 更新举报状态
  await db
    .update(reports)
    .set({
      status: data.status,
      adminNote: data.adminNote || null,
      resolvedAt: new Date(),
      resolvedBy: adminId,
    })
    .where(eq(reports.id, id));
  
  // 返回更新后的举报
  return getReportById(id);
}
